import * as THREE from 'three';
import { quality, texSize } from './quality';

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

/**
 * A square canvas, at whatever size the machine has been judged good for.
 *
 * Every size below is the one the surface was authored at; what actually gets
 * allocated is that stepped down once or twice. It is the cheapest lever in
 * the whole scene and the one that matters most on a phone — halving an edge
 * quarters the upload, quarters the memory, and quarters the bandwidth every
 * sample of it costs for the rest of the session. All the sizes are powers of
 * two, so they stay that way after stepping and keep their mipmaps.
 */
function canvas(base: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, limit = 2) {
  const size = texSize(base, limit);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  /* Drawn in the authored coordinate space and scaled on the way in, so a
     smaller texture is the same surface at lower resolution rather than the
     same pixels showing a quarter of it. */
  if (size !== base) ctx.scale(size / base, size / base);
  draw(ctx, base);
  return c;
}

/**
 * The same, for a surface that is not square.
 *
 * A keyboard is two and a half times wider than it is deep and a screen is
 * eight to five. Drawing either into a square canvas and letting the UVs
 * stretch it back out would put the distortion into the keys and the letters,
 * which are the only things on either surface anybody would look at. The short
 * edge follows the long one down through the tiers, so the aspect is the one
 * thing about these that never changes.
 */
function sheet(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  limit = 1,
) {
  const cw = texSize(w, limit);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = Math.round(h * (cw / w));
  const ctx = c.getContext('2d')!;
  if (cw !== w) ctx.scale(cw / w, cw / w);
  draw(ctx, w, h);
  return c;
}

function tex(c: HTMLCanvasElement, repeat: number | [number, number], srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat, repeat];
  t.repeat.set(rx, ry);
  t.anisotropy = quality().anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/**
 * A height field, squeezed into the roughness range a material actually has.
 *
 * Height maps run the full nought-to-one, and handing one straight to
 * `roughnessMap` says the dark grain of a board is a perfect mirror and the
 * light grain is chalk. Oak is 0.3 to 0.55 everywhere; concrete never leaves
 * the top quarter. Getting the band right is most of the difference between a
 * surface that catches the window the way the real material would and one
 * that looks sprayed with varnish — and it matters far more now that what it
 * is catching is a capture of the room rather than a grey studio.
 */
function levels(height: HTMLCanvasElement, lo: number, hi: number) {
  const out = document.createElement('canvas');
  out.width = height.width;
  out.height = height.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(height, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${Math.round((hi - lo) * 255)},${Math.round((hi - lo) * 255)},${Math.round((hi - lo) * 255)})`;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgb(${Math.round(lo * 255)},${Math.round(lo * 255)},${Math.round(lo * 255)})`;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/** A third texture per surface for a second-order cue: the first thing to go. */
const wantRoughness = () => quality().roughnessMaps;

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
  const w = src.width;
  const h = src.height;
  const from = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => from[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
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
  const out = document.createElement('canvas');
  out.width = height.width;
  out.height = height.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(height, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.34;
  ctx.fillRect(0, 0, out.width, out.height);
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
    // finished wood: satin everywhere, a shade duller down the open pores
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.3, 0.6), repeat, false));
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
    // limewash is chalk: matt from end to end, with the tooth a touch mattest
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.84, 1), 5, false));
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
    /* Where the pour met the shuttering it took the board's polish, and where
       it dried open it did not — the reason a concrete wall reads as poured
       rather than painted is that the sheen is uneven across a single panel. */
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.72, 1), [3, 4], false));
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
    // the crown of each thread catches; the gaps between them do not
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.74, 1), 26, false));
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

    // one step down at most, wherever the tier stands: this is the surface the
    // app is named after, and it is read from a hand's breadth away
    const colour = canvas(size, (ctx) => paint(ctx, false), 1);
    const height = canvas(size, (ctx) => paint(ctx, true), 1);

    // roughly a metre of cork per tile, which is about the granule scale a
    // sheet this size actually has
    const rep: [number, number] = [3.6, 2.4];
    cache.set(ck, tex(colour, rep, true));
    cache.set(`${ck}:n`, tex(heightToNormal(height, 2.6), rep, false));
    // granule faces have a faint sheen; the seams between them swallow light
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(height, 0.8, 1), rep, false));
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

/* ------------------------------------------------------------------ glass */

/**
 * The state a window is actually in.
 *
 * Clean glass is a perfect mirror, and a perfect mirror is the one surface a
 * single captured reflection cannot fake: it shows you the capture point, and
 * the moment the camera moves off that point the reflection is visibly
 * painted on. Real glass has been cleaned in arcs, rained on, and stood in a
 * city for a year — and every one of those marks scatters the reflection just
 * enough that the eye stops checking it against the room.
 *
 * So this is a roughness map, almost entirely: broad sweeps where a cloth
 * went, a fine grime toward the edges of each pane, and the odd streak. It is
 * the cheapest honest way to make a fake reflection survive being looked at.
 */
export function smears(): Maps {
  const ck = 'smears';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(31337);
    const h = canvas(512, (ctx, s) => {
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(0, 0, s, s);

      // the arcs a cloth leaves, which is why they always look like this
      ctx.strokeStyle = '#cfcfcf';
      ctx.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        const cx = rnd() * s;
        const cy = rnd() * s;
        const r = 60 + rnd() * 180;
        ctx.globalAlpha = 0.1 + rnd() * 0.16;
        ctx.lineWidth = 6 + rnd() * 22;
        ctx.beginPath();
        ctx.arc(cx, cy, r, rnd() * 6, rnd() * 3 + 1);
        ctx.stroke();
      }

      // grime, heaviest where the frame holds the pane
      ctx.globalAlpha = 1;
      const edge = ctx.createLinearGradient(0, 0, 0, s);
      edge.addColorStop(0, 'rgba(190,190,190,0.5)');
      edge.addColorStop(0.18, 'rgba(190,190,190,0)');
      edge.addColorStop(0.84, 'rgba(190,190,190,0)');
      edge.addColorStop(1, 'rgba(180,180,180,0.6)');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, s, s);

      // rain, and whatever the last storm left running down it
      ctx.strokeStyle = '#d6d6d6';
      for (let i = 0; i < 34; i++) {
        const x = rnd() * s;
        ctx.globalAlpha = 0.06 + rnd() * 0.12;
        ctx.lineWidth = 1 + rnd() * 3;
        ctx.beginPath();
        ctx.moveTo(x, rnd() * s * 0.4);
        ctx.lineTo(x + (rnd() - 0.5) * 18, s);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 0.35), [1, 2], false));
    // never matt, never a mirror: the band a pane of glass lives in
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.02, 0.26), [1, 2], false));
  }
  return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
}

/* ------------------------------------------------------------------ metal */

/**
 * Brushed steel and brass, drawn along the grain.
 *
 * Metal is the surface a captured reflection pays off on most and fails on
 * worst. A mirror-smooth mullion reflects the probe exactly, from the one
 * point the probe was taken at; a brushed one smears that reflection along
 * the direction of the brushing, which is both what the real thing does and
 * what hides the fact that there is only one capture. The anisotropy is in
 * the drawing rather than in the shader: long thin scratches in a height
 * field come out of the normal map as a directional smear for nothing.
 */
export function brushed(): Maps {
  const ck = 'brushed';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(880102);
    const h = canvas(256, (ctx, s) => {
      ctx.fillStyle = '#8c8c8c';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 4200; i++) {
        const y = rnd() * s;
        const len = 20 + rnd() * 210;
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rnd() * 0.1})`;
        ctx.fillRect(rnd() * s, y, len, 1);
      }
      // the odd deeper scratch, which is what stops it reading as fine sand
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.1 + rnd() * 0.18})`;
        ctx.fillRect(rnd() * s, rnd() * s, 40 + rnd() * 200, 1);
      }
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 0.9), [3, 3], false));
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.18, 0.46), [3, 3], false));
  }
  return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
}

/* ---------------------------------------------------------------- machine */

/** Wrapping is for surfaces that tile. These two are pictures of one thing. */
function clamped(t: THREE.Texture) {
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * The keyboard well: the keys, and the drilled strips either side of them.
 *
 * Seventy-odd keys as seventy-odd boxes would be a thousand vertices spent on
 * an object the size of a postcard on screen, and the trace shares its rays
 * out by vertex — so modelling them would not only cost the frame, it would
 * take the light off everything else on the counter. Drawn instead, the whole
 * well is one quad, and the keys get something geometry could not have given
 * them at this size anyway: an edge sharp enough to survive being looked at.
 *
 * Laid out once and inked twice. Everywhere else in this file the colour is
 * derived from the height, because a board's colour really is its depth; here
 * it is not — the caps are the palest thing on the machine and the frame they
 * sit in is the darkest. So the same layout runs through two palettes: greys
 * for the relief, and the real colours for the map.
 */
interface Deck {
  floor: string;
  skirt: string;
  cap: string;
}

function deckOf(p: Deck) {
  return sheet(1024, 384, (ctx, w, d) => {
    ctx.fillStyle = p.floor;
    ctx.fillRect(0, 0, w, d);

    const rr = (x: number, y: number, kw: number, kh: number, r: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, kw, kh, r);
      ctx.fill();
    };

    /* Two steps rather than one. A cap that goes from the floor of the well to
       its full height in a single pixel comes out of the normal map as a wall;
       the skirt is what makes it read as a chamfer you could run a fingernail
       down. */
    const cap = (x: number, y: number, kw: number, kh: number) => {
      rr(x, y, kw, kh, 6, p.skirt);
      rr(x + 2.5, y + 2.5, kw - 5, kh - 5, 4.5, p.cap);
    };

    /* The rows are relative widths, not pixels: a tab key is one and a half of
       a letter key on every keyboard ever made, and the unit falls out of
       whatever room the row has left once the gaps are taken out. The keys
       fill the well, which is what puts a cap at sixteen millimetres across —
       the one measurement on a keyboard that every hand already knows. */
    const x0 = 24;
    const span = 976;
    const gap = 7;
    const letters = (n: number) => Array<number>(n).fill(1);
    const row = (y: number, kh: number, widths: number[], width = span) => {
      const unit = (width - gap * (widths.length - 1)) / widths.reduce((a, b) => a + b, 0);
      let x = x0;
      for (const rel of widths) {
        cap(x, y, unit * rel, kh);
        x += unit * rel + gap;
      }
      return x;
    };

    row(12, 40, [1.6, ...letters(12), 1.6]);
    row(58, 58, [...letters(13), 1.75]);
    row(122, 58, [1.5, ...letters(12), 1.25]);
    row(186, 58, [1.75, ...letters(11), 1.9]);
    row(250, 58, [2.3, ...letters(10), 2.3]);
    const end = row(314, 58, [1, 1, 1, 1.25, 5.4, 1.25, 1], span - 172);

    // the inverted T, the one corner of a keyboard nobody has ever redrawn
    const aw = (x0 + span - end - gap * 2) / 3;
    cap(end, 314, aw, 58);
    cap(end + aw + gap, 314, aw, 26);
    cap(end + aw + gap, 346, aw, 26);
    cap(end + (aw + gap) * 2, 314, aw, 58);
  });
}

export function keyboard(): Maps {
  const ck = 'keyboard';
  if (!cache.has(ck)) {
    const relief = deckOf({ floor: '#232323', skirt: '#8e8e8e', cap: '#e9e9e9' });
    const colour = deckOf({ floor: '#33342e', skirt: '#b9b7ab', cap: '#eceade' });
    cache.set(ck, clamped(tex(colour, 1, true)));
    cache.set(`${ck}:n`, clamped(tex(heightToNormal(relief, 1.5), 1, false)));
    // moulded plastic: matt on the caps, a shade less so down in the gaps
    if (wantRoughness()) cache.set(`${ck}:r`, clamped(tex(levels(relief, 0.52, 0.84), 1, false)));
  }
  return {
    map: cache.get(ck),
    normalMap: cache.get(`${ck}:n`),
    roughnessMap: cache.get(`${ck}:r`),
  };
}

/**
 * A display that is on, bezel and all, as one picture.
 *
 * The bezel is in the texture rather than in the lid because the join between
 * the two is the thing that gives a screen away: a black rectangle laid over
 * a metal one leaves a seam that catches the window, and nothing else in the
 * room has a seam there. Drawn together they share an edge exactly, and the
 * corners can be rounded the way this machine's are without any of that
 * costing a single triangle.
 *
 * What is on it is the wallpaper this machine is always photographed wearing:
 * soft vertical columns of colour, blurred into each other until the joins are
 * gone. It is the one saturated thing in a room of oak and cream, which is
 * exactly what a screen is when you walk into a kitchen and one is open.
 */
export function screen(): Maps {
  const ck = 'screen';
  if (!cache.has(ck)) {
    const face = sheet(1024, 716, (ctx, w, h) => {
      const bezel = '#26282a';
      ctx.fillStyle = bezel;
      ctx.fillRect(0, 0, w, h);

      // thin at the sides, a little over at the top for the camera, and a chin
      const x0 = 14;
      const y0 = 26;
      const sw = w - 28;
      const sh = h - y0 - 68;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x0, y0, sw, sh, 18);
      ctx.clip();

      ctx.fillStyle = '#f7f6e6';
      ctx.fillRect(x0, y0, sw, sh);

      /* Drawn blurred rather than blended. Seven capsules wider than the gaps
         between them, put down through a blur that is most of a column wide,
         come out as one continuous wash with no two edges meeting — which is
         the whole trick of every wallpaper that has ever shipped on a laptop. */
      const columns = [
        { tint: '#f0e64a', top: 0.06, foot: 0.72 },
        { tint: '#a8d648', top: 0.15, foot: 1.04 },
        { tint: '#5ecb9a', top: 0.04, foot: 0.58 },
        { tint: '#42c4dd', top: 0.19, foot: 1.06 },
        { tint: '#fdfae0', top: 0.03, foot: 0.78 },
        { tint: '#b6dc46', top: 0.11, foot: 1.05 },
        { tint: '#f4ec58', top: 0.05, foot: 0.86 },
      ];
      const cw = sw / columns.length;
      /* Enough blur to lose the edges, not so much that the capsules lose
         their shape — the wallpaper is columns of colour, and a column that
         has been blurred until it has no top is a wash. */
      ctx.filter = 'blur(15px)';
      columns.forEach((col, i) => {
        ctx.fillStyle = col.tint;
        ctx.beginPath();
        ctx.roundRect(
          x0 + i * cw + 5, y0 + col.top * sh, cw - 10, (col.foot - col.top) * sh, cw * 0.46,
        );
        ctx.fill();
      });
      // and the two that have drifted off the columns and gone round
      for (const [fx, fy, fr, tint] of [
        [0.37, 0.52, 0.11, '#ffffff'],
        [0.66, 0.3, 0.08, '#7fdfe8'],
      ] as [number, number, number, string][]) {
        ctx.fillStyle = tint;
        ctx.globalAlpha = 0.66;
        ctx.beginPath();
        ctx.ellipse(x0 + sw * fx, y0 + sh * fy, sh * fr, sh * fr * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.filter = 'none';

      /* The sheen. A screen is a mirror the moment it stops being brighter
         than the room, and it is never quite brighter than a window. */
      const glare = ctx.createLinearGradient(x0, y0, x0 + sw * 0.7, y0 + sh);
      glare.addColorStop(0, 'rgba(255,255,255,0.16)');
      glare.addColorStop(0.45, 'rgba(255,255,255,0.03)');
      glare.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glare;
      ctx.fillRect(x0, y0, sw, sh);
      ctx.restore();

      // the notch, and the camera that is the reason for it
      ctx.fillStyle = bezel;
      ctx.beginPath();
      ctx.roundRect((w - 164) / 2, 0, 164, y0 + 26, [0, 0, 9, 9]);
      ctx.fill();
      ctx.fillStyle = '#15171a';
      ctx.beginPath();
      ctx.arc(w / 2, y0 + 1, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,168,186,0.5)';
      ctx.beginPath();
      ctx.arc(w / 2 - 1.6, y0 - 1, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // and the name of the thing, etched into the chin
      ctx.fillStyle = '#797d80';
      ctx.font = '600 17px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = '6px';
      ctx.fillText('fujikey nero', w / 2 + 3, h - 34);
      ctx.letterSpacing = '0px';
    });

    cache.set(ck, clamped(tex(face, 1, true)));
  }
  return { map: cache.get(ck) };
}

/**
 * Anodised aluminium: blasted, then dyed.
 *
 * Anodising is not paint. The metal is taken down to a fine even tooth, and
 * the colour goes into the oxide layer grown on top of it rather than onto it,
 * which is why a yellow laptop still reads as metal and a yellow painted one
 * reads as a toy. So the colour is not in here at all — it stays on the
 * material, where it belongs, and what this supplies is the tooth: two scales
 * of blast pitting for the sparkle, and a slow unevenness under them, because
 * a dye in a grown layer is never quite the same depth twice.
 *
 * Everything is drawn in a wrapped pass so the grain survives being tiled, and
 * the whole square covers about a metre of surface — which puts the pitting
 * near a millimetre, invisible across the room and there when you lean in,
 * exactly as it is on the real thing.
 */
export function anodised(): Maps {
  const ck = 'anodised';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(1959);
    const h = canvas(512, (ctx, s) => {
      ctx.fillStyle = '#8f8f8f';
      ctx.fillRect(0, 0, s, s);

      /* The unevenness in the dye. Drawn nine times over, once into the square
         and once for each way out of it, so what runs off one edge arrives
         back at the other and the tiling has no seam to find. */
      ctx.filter = `blur(${s / 24}px)`;
      for (let i = 0; i < 30; i++) {
        const cx = rnd() * s;
        const cy = rnd() * s;
        const rx = s * (0.06 + rnd() * 0.16);
        const ry = s * (0.06 + rnd() * 0.16);
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},0.07)`;
        for (const ox of [-s, 0, s]) {
          for (const oy of [-s, 0, s]) {
            ctx.beginPath();
            ctx.ellipse(cx + ox, cy + oy, rx, ry, rnd() * 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.filter = 'none';

      // and the blasting: fine everywhere, with the odd deeper pit in it
      for (let i = 0; i < 16000; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${0.04 + rnd() * 0.14})`;
        ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
      }
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.1})`;
        ctx.fillRect(rnd() * s, rnd() * s, 2, 2);
      }
    });

    /* A thousandth, because the UVs an extrusion generates are in the units
       the shape was drawn in. One square of this covers a metre of case, so
       the grain is the same size on the lid, the palm rest and the underside
       without any of them having to be told what size they are. */
    cache.set(`${ck}:n`, tex(heightToNormal(h, 0.7), 1 / 1000, false));
    // satin: never chalk, never a mirror, and a shade duller down in the pits
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.6, 1), 1 / 1000, false));
  }
  return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
}

/** Everything above, dropped at once. */
export function disposeTextures() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
