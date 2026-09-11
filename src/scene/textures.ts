import * as THREE from 'three';

/**
 * Every surface in the room, drawn once into a canvas.
 *
 * Baking beats evaluating. The room this replaced computed its plaster and its
 * oak per pixel, per frame, which is what made zooming crawl — the cost scaled
 * with the screen, and every frame paid it again for a wall that never changes.
 * These are drawn once at load, uploaded as tiling textures, and after that the
 * GPU is only sampling. Nothing here runs again while the camera moves.
 *
 * They are procedural rather than photographic for the same reasons the cork
 * always has been: no network, no licences, and a palette that can be tuned to
 * the room instead of the other way round.
 */

const cache = new Map<string, THREE.Texture>();

function canvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  return c;
}

function tex(c: HTMLCanvasElement, repeat: number | [number, number], srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat, repeat];
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Deterministic noise, so a reload gives the same room. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A height field, differenced into a tangent-space normal map.
 *
 * Cheaper and far more controllable than authoring normals directly: draw the
 * bumps as greyscale — grain, weave, plaster tooth — and the slopes follow.
 */
function heightToNormal(src: HTMLCanvasElement, strength: number) {
  const s = src.width;
  const from = src.getContext('2d')!.getImageData(0, 0, s, s).data;
  const out = document.createElement('canvas');
  out.width = out.height = s;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  const at = (x: number, y: number) => from[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/* ------------------------------------------------------------------- wood */

/**
 * Flat-sawn oak, along the grain.
 *
 * The long arcs are the point. Straight parallel lines read as corduroy and
 * random noise reads as marble; it is the slow cathedral sweep of a board cut
 * off-centre through the log that says "wood" before any colour does.
 */
function oakHeight(seed: number, size = 1024) {
  const rnd = rng(seed);
  return canvas(size, (ctx, s) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, s, s);

    for (let i = 0; i < 190; i++) {
      const y = rnd() * s;
      const amp = (rnd() > 0.72 ? 1 : 0.3) * (4 + rnd() * 34);
      const dark = rnd() > 0.42;
      const w = 0.6 + rnd() * 3.4;
      ctx.strokeStyle = dark ? '#4a4a4a' : '#c2c2c2';
      ctx.globalAlpha = 0.10 + rnd() * 0.30;
      ctx.lineWidth = w;
      // drawn three times, offset by a tile, so the arc survives the wrap
      for (const off of [-s, 0, s]) {
        ctx.beginPath();
        ctx.moveTo(-20, y + off);
        ctx.quadraticCurveTo(s * (0.2 + rnd() * 0.6), y - amp + off, s + 20, y + (rnd() - 0.5) * 14 + off);
        ctx.stroke();
      }
    }

    // open pores, the thing that separates oak from a painted stripe
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#3e3e3e';
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      ctx.fillRect(x, y, 1 + rnd() * 5, 1);
    }
    ctx.globalAlpha = 1;
  });
}

export interface Maps {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

/** Tint a height field into a colour map: dark grain, light field. */
function tintFrom(height: HTMLCanvasElement, light: string, dark: string) {
  const s = height.width;
  const out = document.createElement('canvas');
  out.width = out.height = s;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(height, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.34;
  ctx.fillRect(0, 0, s, s);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

export function oak(
  key: string,
  { light, dark, repeat = 1, bump = 2.2, seed = 91 }:
    { light: string; dark: string; repeat?: number | [number, number]; bump?: number; seed?: number },
): Maps {
  const ck = `oak:${key}`;
  if (!cache.has(ck)) {
    const h = oakHeight(seed);
    cache.set(ck, tex(tintFrom(h, light, dark), repeat, true));
    cache.set(`${ck}:n`, tex(heightToNormal(h, bump), repeat, false));
    cache.set(`${ck}:r`, tex(h, repeat, false));
  }
  return {
    map: cache.get(ck),
    normalMap: cache.get(`${ck}:n`),
    roughnessMap: cache.get(`${ck}:r`),
  };
}

/* ---------------------------------------------------------------- plaster */

/** Limewash: a slow trowel unevenness with a fine tooth over it. */
export function plaster(): Maps {
  const ck = 'plaster';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(20260910);
    const h = canvas(512, (ctx, s) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        const g = ctx.createRadialGradient(rnd() * s, rnd() * s, 0, rnd() * s, rnd() * s, 60 + rnd() * 170);
        const v = rnd() > 0.5 ? 255 : 0;
        g.addColorStop(0, `rgba(${v},${v},${v},0.08)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
      for (let i = 0; i < 26000; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rnd() * 0.09})`;
        ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd(), 1 + rnd());
      }
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 1.5), 5, false));
    cache.set(`${ck}:r`, tex(h, 5, false));
  }
  return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
}

/* --------------------------------------------------------------- concrete */

/**
 * Board-formed concrete: one poured panel per tile.
 *
 * The seam and the two tie holes are drawn at the tile's own edge rather than
 * added as geometry, so the panel grid comes free with the repeat — set it to
 * four down the wall and the wall has four courses. They are what makes it
 * read as poured rather than as grey paint; a concrete wall without the marks
 * of how it was made is just a colour.
 */
export function concrete(): Maps {
  const ck = 'concrete';
  if (!cache.has(ck)) {
    const rnd = rng(70113);
    const h = canvas(1024, (ctx, s) => {
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(0, 0, s, s);

      // where the pour dried faster, damper, or against a different board
      for (let i = 0; i < 46; i++) {
        const g = ctx.createRadialGradient(rnd() * s, rnd() * s, 0, rnd() * s, rnd() * s, 90 + rnd() * 300);
        const v = rnd() > 0.48 ? 255 : 0;
        g.addColorStop(0, `rgba(${v},${v},${v},0.075)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }

      // the grain of the shuttering boards, running across the pour
      ctx.globalAlpha = 0.5;
      for (let y = 0; y < s; y += 3) {
        const v = 138 + (rnd() - 0.5) * 26;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(0, y, s, 1 + rnd());
      }
      ctx.globalAlpha = 1;

      // fine aggregate, and the odd air pocket a wall never quite loses
      for (let i = 0; i < 42000; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${0.04 + rnd() * 0.1})`;
        ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 1.6, 1 + rnd());
      }
      for (let i = 0; i < 34; i++) {
        const x = rnd() * s;
        const y = rnd() * s;
        const r = 2 + rnd() * 5;
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      }

      // the joint between one lift and the next, at the tile's own edge
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(0, 0, s, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(0, 7, s, 3);

      // and the holes the form ties came out of
      for (const tx of [s * 0.22, s * 0.72]) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(tx, 62, 11, 0, 7);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(tx, 57, 8, 0, 7);
        ctx.fill();
      }
    });
    cache.set(ck, tex(tintFrom(h, '#a9a9a6', '#3d3d3c'), [3, 4], true));
    cache.set(`${ck}:n`, tex(heightToNormal(h, 1.9), [3, 4], false));
    cache.set(`${ck}:r`, tex(h, [3, 4], false));
  }
  return {
    map: cache.get(ck),
    normalMap: cache.get(`${ck}:n`),
    roughnessMap: cache.get(`${ck}:r`),
  };
}

/* ----------------------------------------------------------------- fabric */

/** Upholstery: a tight weave, for the chair. */
export function fabric(): Maps {
  const ck = 'fabric';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(9091);
    const h = canvas(256, (ctx, s) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 4) {
        for (let x = 0; x < s; x += 4) {
          const over = ((x / 4 + y / 4) | 0) % 2 === 0;
          ctx.fillStyle = over ? '#a4a4a4' : '#5e5e5e';
          ctx.fillRect(x, y, 4, 4);
        }
      }
      for (let i = 0; i < 12000; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},0.1)`;
        ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
      }
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 1.4), 26, false));
    cache.set(`${ck}:r`, tex(h, 26, false));
  }
  return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
}

/* ------------------------------------------------------------------- cork */

/**
 * Cork, as a surface in the room rather than a picture of one.
 *
 * This used to be nine stacked CSS background layers — four of them tiled SVG
 * — on a 3600x2400 element sitting in the DOM over the scene. Every time the
 * camera changed the angle that element was projected at, the browser had to
 * re-composite all nine across a layer far larger than the screen. Desktop
 * absorbed it; phones, which rasterise big layers in tiles and evict those
 * tiles under memory pressure, showed it as the texture flickering.
 *
 * Here it is one tiling texture on the panel that was already in the scene.
 * The GPU samples it with mipmaps and anisotropy, so it is sharper than the
 * CSS version at distance, and it now takes the room's own light — which is
 * what the painted gradients on the old one were imitating.
 */
export function cork(): Maps {
  const ck = 'cork';
  if (!cache.has(ck)) {
    const size = 1024;
    const rnd = rng(20260907);

    // Real cork is a mat of compressed granules: irregular light and dark
    // flecks with darker seams between them. Mid tones dominate; bright flecks
    // are rare, which is what stops it reading as leopard print.
    const grains: Array<[string, number, number]> = [
      ['#c1904f', 0.46, 0.62],
      ['#b5854f', 0.46, 0.58],
      ['#a2703a', 0.5, 0.46],
      ['#cb9d5f', 0.34, 0.72],
      ['#8d5c31', 0.5, 0.38],
      ['#96683a', 0.5, 0.46],
      ['#d8ab6d', 0.24, 0.8],
      ['#6f4826', 0.42, 0.28],
      ['#e8cb98', 0.14, 0.9],
    ];

    type Blob = { x: number; y: number; rx: number; ry: number; rot: number; i: number; a: number };
    const granules: Blob[] = [];
    const seams: Array<[number, number, number, number]> = [];
    const holes: Array<[number, number, number]> = [];

    /*
     * Two scales of granule, so the repeat never resolves into a pattern.
     *
     * The multiplier is what sets their real-world size, and it matters: a tile
     * is a metre of board, so at 1.9 the flecks came out a centimetre across
     * and the sheet read as cereal rather than as cork. Real granules are two
     * to five millimetres.
     */
    for (const [count, scale] of [[3000, 0.62], [1700, 1.25]] as const) {
      for (let i = 0; i < count; i++) {
        granules.push({
          x: rnd() * size,
          y: rnd() * size,
          rx: (3.4 + rnd() * 9) * scale * 0.88,
          ry: (2.2 + rnd() * 4.6) * scale * 0.88,
          rot: rnd() * Math.PI,
          i: Math.floor(rnd() * grains.length),
          a: rnd(),
        });
      }
    }
    // the dark seams and pits between the granules, which are most of what
    // keeps it from going flat and pale
    for (let i = 0; i < 2600; i++) {
      seams.push([rnd() * size, rnd() * size, (0.5 + rnd() * 1.5) * 1.15, 0.2 + rnd() * 0.34]);
    }
    // old pin holes, left behind by everything that used to hang here
    for (let i = 0; i < 5; i++) holes.push([rnd() * size, rnd() * size, 3 + rnd() * 3]);

    /** Drawn nine times at tile offsets so shapes survive the wrap. */
    const paint = (ctx: CanvasRenderingContext2D, height: boolean) => {
      ctx.fillStyle = height ? '#808080' : '#9a6a33';
      ctx.fillRect(0, 0, size, size);
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          for (const g of granules) {
            const [fill, op, lum] = grains[g.i];
            ctx.fillStyle = height
              ? `rgba(${Math.round(lum * 255)},${Math.round(lum * 255)},${Math.round(lum * 255)},${op})`
              : fill;
            ctx.globalAlpha = height ? 1 : op;
            ctx.beginPath();
            ctx.ellipse(g.x + ox, g.y + oy, g.rx, g.ry, g.rot, 0, 7);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          for (const [x, y, r, op] of seams) {
            ctx.fillStyle = height ? `rgba(20,20,20,${op})` : `rgba(79,49,21,${op})`;
            ctx.beginPath();
            ctx.arc(x + ox, y + oy, r, 0, 7);
            ctx.fill();
          }
          for (const [x, y, r] of holes) {
            ctx.fillStyle = height ? 'rgba(10,10,10,0.7)' : 'rgba(81,51,20,0.55)';
            ctx.beginPath();
            ctx.ellipse(x + ox, y + oy, r, r * 0.85, 0, 0, 7);
            ctx.fill();
            // the lip of compressed cork the pin pushed up below the hole
            ctx.fillStyle = height ? 'rgba(235,235,235,0.5)' : 'rgba(236,203,158,0.34)';
            ctx.beginPath();
            ctx.ellipse(x + ox, y + oy + r * 0.75, r * 0.9, r * 0.5, 0, 0, 7);
            ctx.fill();
          }
        }
      }
    };

    const colour = canvas(size, (ctx) => paint(ctx, false));
    const height = canvas(size, (ctx) => paint(ctx, true));

    // roughly a metre of cork per tile, which is about the granule scale a
    // sheet this size actually has
    const rep: [number, number] = [3.6, 2.4];
    cache.set(ck, tex(colour, rep, true));
    cache.set(`${ck}:n`, tex(heightToNormal(height, 2.6), rep, false));
    cache.set(`${ck}:r`, tex(height, rep, false));
  }
  return {
    map: cache.get(ck),
    normalMap: cache.get(`${ck}:n`),
    roughnessMap: cache.get(`${ck}:r`),
  };
}

/* ------------------------------------------------------------------ weave */

/** Coiled seagrass, for the baskets and the tray. */
export function weave(): Maps {
  const ck = 'weave';
  if (!cache.has(ck)) {
    const rnd = rng(4477);
    const h = canvas(512, (ctx, s) => {
      ctx.fillStyle = '#6f6f6f';
      ctx.fillRect(0, 0, s, s);
      const pitch = 26;
      for (let y = 0; y < s; y += pitch) {
        for (let x = 0; x < s; x += pitch) {
          const over = ((x / pitch + y / pitch) | 0) % 2 === 0;
          ctx.fillStyle = over ? '#c8c8c8' : '#454545';
          ctx.beginPath();
          if (over) ctx.ellipse(x + pitch / 2, y + pitch / 2, pitch * 0.52, pitch * 0.3, 0, 0, 7);
          else ctx.ellipse(x + pitch / 2, y + pitch / 2, pitch * 0.3, pitch * 0.52, 0, 0, 7);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < 9000; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
      }
      ctx.globalAlpha = 1;
    });
    cache.set(ck, tex(tintFrom(h, '#d9c096', '#6d5836'), 3, true));
    cache.set(`${ck}:n`, tex(heightToNormal(h, 3.4), 3, false));
  }
  return { map: cache.get(ck), normalMap: cache.get(`${ck}:n`) };
}

/* ------------------------------------------------------------------ paper */

/** Laid paper, for envelopes and the pages of a book. */
export function paper(): Maps {
  const ck = 'paper';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(1201);
    const h = canvas(256, (ctx, s) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 9000; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},0.16)`;
        ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 3, 1);
      }
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 1.1), 4, false));
  }
  return { normalMap: cache.get(`${ck}:n`) };
}

/** Everything above, dropped at once. */
export function disposeTextures() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
