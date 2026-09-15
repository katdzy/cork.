import * as THREE from 'three';
import { detail, quality, texSize } from './quality';

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
 *
 * `willReadFrequently` asks for the software backend, and is worth asking for
 * twice over. Half of these canvases are height fields that
 * `heightToNormal` reads straight back out, and reading a GPU-backed canvas
 * means a stall while the driver flushes everything queued against it and
 * copies it back across the bus — the single worst thing to do on a tiled
 * mobile GPU, where that bus is the thing the whole architecture exists to
 * avoid crossing. The other half is that these draws are not what GPU canvas
 * is good at: tens of thousands of one-pixel `fillRect`s are all per-call
 * overhead and no fill, and the software backend draws them faster than the
 * hardware one does. Measured on a fast desktop, asking for it took the
 * concrete wall from 59ms to 33ms; the gap is wider on a phone.
 */
function canvas(base: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, limit = 2) {
  const size = texSize(base, limit);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
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
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
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
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(w, h);
  const to = img.data;

  /*
   * The wrap, worked out once per column instead of twice per sample.
   *
   * These textures tile, so the differencing has to come round the edges or
   * every surface in the room gets a seam down it — but the version that
   * wrote that as `(x + w) % w` inside a helper paid for it everywhere, four
   * samples a pixel, to get a different answer on two of them. Two integer
   * divisions per sample is not much on a desktop and is real money on an
   * in-order mobile core, and this is a quarter of a million pixels.
   *
   * `Math.hypot` went the same way. It is variadic and carefully guarded
   * against overflow, neither of which V8 can optimise away and neither of
   * which is wanted here: the slopes are bounded by `strength`, a small
   * single-digit number. The plain square root gives byte-for-byte the same
   * image and the pair together roughly halve the pass.
   */
  const left = new Int32Array(w);
  const right = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    left[x] = (x === 0 ? w - 1 : x - 1) * 4;
    right[x] = (x === w - 1 ? 0 : x + 1) * 4;
  }

  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    const up = (y === 0 ? h - 1 : y - 1) * w * 4;
    const down = (y === h - 1 ? 0 : y + 1) * w * 4;
    for (let x = 0; x < w; x++) {
      const x4 = x * 4;
      const dx = ((from[row + right[x]] - from[row + left[x]]) / 255) * strength;
      const dy = ((from[down + x4] - from[up + x4]) / 255) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = row + x4;
      to[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      to[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      to[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      to[i + 3] = 255;
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

    for (let i = 0, n = detail(190); i < n; i++) {
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
    for (let i = 0, n = detail(2600); i < n; i++) {
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
      for (let i = 0, n = detail(26000); i < n; i++) {
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
 * Concrete, in the two ways it gets made.
 *
 * **Board-formed** — the default — is a wall: poured against timber shuttering,
 * one panel per tile. The seam and the two tie holes are drawn at the tile's
 * own edge rather than added as geometry, so the panel grid comes free with
 * the repeat — set it to four down the wall and the wall has four courses.
 * They are what makes it read as poured rather than as grey paint; a concrete
 * wall without the marks of how it was made is just a colour.
 *
 * **Slab** is the ground: poured flat, floated, and walked on. It has none of
 * those marks, because there was no formwork to leave them — and that is not
 * a detail, it is the whole reason this option exists. The street outside the
 * kitchen was surfaced with the wall texture, so every tile edge laid a black
 * lift joint across the pavement and every tile laid down two form ties, which
 * arrived on screen as a set of evenly spaced dark lines ruled across the
 * ground with little dark ellipses sitting on them. A wall's marks on a floor
 * do not read as concrete. They read as a rendering fault, which is exactly
 * what they were.
 *
 * The board grain goes with them. On a wall it is the grain of the shuttering;
 * on a slab there was nothing for it to be the grain *of*, and stretched along
 * thirty-five metres of pavement it turned the street into decking.
 */
export function concrete(formwork = true): Maps {
  const ck = formwork ? 'concrete' : 'concrete-slab';
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
      if (formwork) {
        ctx.globalAlpha = 0.5;
        for (let y = 0; y < s; y += 3) {
          const v = 138 + (rnd() - 0.5) * 26;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(0, y, s, 1 + rnd());
        }
        ctx.globalAlpha = 1;
      }

      // fine aggregate, and the odd air pocket a wall never quite loses
      for (let i = 0, n = detail(42000); i < n; i++) {
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

      /* The joint between one lift and the next, at the tile's own edge, and
         the holes the form ties came out of. Both are marks the shuttering
         left, so both belong only to the wall. */
      if (formwork) {
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fillRect(0, 0, s, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(0, 7, s, 3);

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
      }
    });
    /* Denser on the ground, because the ground is enormous. The wall's repeat
       is chosen to put four courses up a room; the same figure spread over
       thirty-five metres of pavement makes every speck of aggregate the size
       of a fist. */
    const rpt: [number, number] = formwork ? [3, 4] : [9, 11];
    cache.set(ck, tex(tintFrom(h, '#a9a9a6', '#3d3d3c'), rpt, true));
    cache.set(`${ck}:n`, tex(heightToNormal(h, 1.9), rpt, false));
    /* Where the pour met the shuttering it took the board's polish, and where
       it dried open it did not — the reason a concrete wall reads as poured
       rather than painted is that the sheen is uneven across a single panel. */
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.72, 1), rpt, false));
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
      for (let i = 0, n = detail(12000); i < n; i++) {
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
    for (let i = 0, n = detail(2600, 1); i < n; i++) {
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
      for (let i = 0, n = detail(9000); i < n; i++) {
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
      for (let i = 0, n = detail(9000); i < n; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},0.16)`;
        ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 3, 1);
      }
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 1.1), 4, false));
  }
  return { normalMap: cache.get(`${ck}:n`) };
}

/* --------------------------------------------------------------- rubbish */

/**
 * Bin-liner plastic.
 *
 * The thing that gives a bag away as a sphere is the highlight: one broad,
 * unbroken smear sliding across it. Real polythene has been stretched over
 * whatever is inside it and creased everywhere it was gathered, and every one
 * of those creases cuts the highlight into pieces — so this is mostly a
 * crease field. They are drawn as short kinked strokes rather than curves
 * because plastic folds along a line and holds it, and the roughness band is
 * wide and low: the flats stay near-glossy, the creases go dull.
 */
export function crinkle(): Maps {
  const ck = 'crinkle';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(4707);
    const h = canvas(256, (ctx, s) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      ctx.lineCap = 'round';
      for (let i = 0, n = detail(300); i < n; i++) {
        const x = rnd() * s;
        const y = rnd() * s;
        const a = rnd() * Math.PI * 2;
        const len = s * (0.04 + rnd() * 0.22);
        const kink = (rnd() - 0.5) * 1.1;
        const v = rnd() > 0.5 ? 210 : 88;
        ctx.strokeStyle = `rgba(${v},${v},${v},${0.22 + rnd() * 0.3})`;
        ctx.lineWidth = 0.6 + rnd() * 1.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len * 0.55, y + Math.sin(a) * len * 0.55);
        ctx.lineTo(x + Math.cos(a + kink) * len, y + Math.sin(a + kink) * len);
        ctx.stroke();
      }
      // the grain of the film itself, under the folds
      for (let i = 0, n = detail(5000); i < n; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},0.06)`;
        ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
      }
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 1.6), 5, false));
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.4, 0.86), 5, false));
  }
  return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
}

/**
 * The mark a pile of rubbish leaves on the pavement it has been sitting on.
 *
 * An alpha mask rather than a colour: it is laid over whatever the ground
 * already is, so the concrete keeps its own grain and only loses its light.
 * Soft-edged, off-centre and lumpy, because a clean ellipse of dirt reads as
 * a shadow the renderer forgot to draw.
 */
export function grime(): THREE.Texture {
  const ck = 'grime';
  if (!cache.has(ck)) {
    const rnd = rng(8812);
    const c = canvas(256, (ctx, s) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, s, s);
      const blot = (x: number, y: number, r: number, a: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.55, `rgba(255,255,255,${a * 0.42})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      };
      blot(s * 0.5, s * 0.52, s * 0.44, 0.82);
      for (let i = 0, n = detail(26, 1); i < n; i++) {
        blot(s * (0.2 + rnd() * 0.6), s * (0.2 + rnd() * 0.6), s * (0.05 + rnd() * 0.2), 0.16 + rnd() * 0.3);
      }
    }, 1);
    const t = tex(c, 1, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    cache.set(ck, t);
  }
  return cache.get(ck)!;
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
      for (let i = 0, n = detail(4200); i < n; i++) {
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
/** Shared atlas coordinates keep the sculpted keycaps and legends aligned. */
export const NERO_KEYS: Array<{ x: number; y: number; w: number; h: number; label: string }> = [];
const neroRow = (y: number, h: number, labels: string[], widths: number[], span = 976) => {
  const unit = (span - 7 * (labels.length - 1)) / widths.reduce((sum, w) => sum + w, 0);
  let x = 24;
  labels.forEach((label, i) => {
    const w = widths[i] * unit;
    NERO_KEYS.push({ x, y, w, h, label });
    x += w + 7;
  });
  return x;
};
neroRow(12, 38, ['esc', '☀', '☼', '▣', '⌕', '◉', '☾', '◀', '▶', '▶▶', '⌁', '−', '+', '◯'], [1.5, ...Array(12).fill(1), 1.5]);
neroRow(58, 56, ['~', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '−', '=', 'delete'], [...Array(13).fill(1), 1.6]);
neroRow(122, 56, ['tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'], [1.45, ...Array(12).fill(1), 1.15]);
neroRow(186, 56, ['caps lock', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'return'], [1.75, ...Array(11).fill(1), 1.85]);
neroRow(250, 56, ['shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'shift'], [2.3, ...Array(10).fill(1), 2.3]);
const arrowStart = neroRow(314, 56, ['fn', 'control', 'option', '⌘', '', '⌘', 'option'], [1, 1, 1, 1.2, 5.4, 1.2, 1], 798);
const arrowW = (1000 - arrowStart - 14) / 3;
NERO_KEYS.push(
  { x: arrowStart, y: 344, w: arrowW, h: 26, label: '◀' },
  { x: arrowStart + arrowW + 7, y: 314, w: arrowW, h: 26, label: '▲' },
  { x: arrowStart + arrowW + 7, y: 344, w: arrowW, h: 26, label: '▼' },
  { x: arrowStart + (arrowW + 7) * 2, y: 344, w: arrowW, h: 26, label: '▶' },
);

export function keyboard(): Maps {
  const ck = 'keyboard';
  if (!cache.has(ck)) {
    const colour = sheet(2048, 768, (ctx) => {
      ctx.scale(2, 2);
      ctx.fillStyle = '#dadbd7';
      ctx.fillRect(0, 0, 1024, 384);
      for (const key of NERO_KEYS) {
        const { x, y, w, h, label } = key;
        const cap = ctx.createLinearGradient(x, y, x, y + h);
        cap.addColorStop(0, '#ffffff');
        cap.addColorStop(0.55, '#f1f2ee');
        cap.addColorStop(1, '#e2e4dd');
        ctx.fillStyle = cap;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        ctx.fillStyle = '#444943';
        ctx.font = `${label.length > 2 ? 10 : 16}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = label.length > 2 ? 'left' : 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, label.length > 2 ? x + 7 : x + w / 2, y + h / 2, w - 10);
        if (label === 'F' || label === 'J') {
          ctx.fillStyle = '#b0b5ac';
          ctx.fillRect(x + w / 2 - 6, y + h - 9, 12, 1.5);
        }
      }
    });
    cache.set(ck, clamped(tex(colour, 1, true)));
  }
  return { map: cache.get(ck) };
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

      // A small webcam in the continuous top bezel, without a notch.
      ctx.fillStyle = '#0b0d10';
      ctx.beginPath();
      ctx.arc(w / 2, 13, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#365265';
      ctx.beginPath();
      ctx.arc(w / 2 - 1, 12, 1.7, 0, Math.PI * 2);
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
export function anodised(fine = false): Maps {
  if (fine) {
    const ck = 'anodised-fine';
    if (!cache.has(`${ck}:n`)) {
      const rnd = rng(1976);
      const grain = canvas(512, (ctx, size) => {
        const pixels = ctx.createImageData(size, size);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const v = 122 + Math.round(rnd() * 12);
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
          pixels.data[i + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
      });
      cache.set(`${ck}:n`, tex(heightToNormal(grain, 0.22), 1 / 160, false));
      if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(grain, 0.84, 1), 1 / 160, false));
    }
    return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
  }
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
      for (let i = 0, n = detail(16000); i < n; i++) {
        const v = rnd() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${0.04 + rnd() * 0.14})`;
        ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
      }
      for (let i = 0, n = detail(900); i < n; i++) {
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

/**
 * Soft-touch plastic, the way a business laptop is finished.
 *
 * The opposite argument to the anodising above. That surface is trying to
 * catch the window; this one is trying not to — a moulded grain fine enough to
 * hide a fingerprint, which is the entire brief of the material and the reason
 * a machine wearing it reads as a tool rather than as jewellery. So the pits
 * are wider and shallower than blasting leaves, and the roughness band sits
 * high and narrow: matte everywhere, and no part of it ever quite shines.
 */
export function softTouch(): Maps {
  const ck = 'soft';
  if (!cache.has(`${ck}:n`)) {
    const rnd = rng(30412);
    const h = canvas(512, (ctx, s) => {
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(0, 0, s, s);
      // a moulded pebble: overlapping soft dimples rather than sharp pitting
      for (let i = 0, n = detail(5200); i < n; i++) {
        const r = 0.65 + rnd() * 1.15;
        const v = rnd() > 0.5 ? 235 : 30;
        ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rnd() * 0.09})`;
        ctx.beginPath();
        ctx.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    cache.set(`${ck}:n`, tex(heightToNormal(h, 0.28), 1 / 240, false));
    if (wantRoughness()) cache.set(`${ck}:r`, tex(levels(h, 0.86, 1), 1 / 240, false));
  }
  return { normalMap: cache.get(`${ck}:n`), roughnessMap: cache.get(`${ck}:r`) };
}

/* ------------------------------------------------------------ the other one */

/** A separate atlas for the Tinkerbel's dark, dished keyboard. */
export const THINK_KEYS = NERO_KEYS.map((key, index) => ({
  ...key,
  x: 14 + (key.x - 24) * (996 / 976),
  y: 8 + (key.y - 12) * 0.86,
  w: key.w * (996 / 976),
  h: key.h * 0.86,
  label: index > 0 && index < 13 ? `F${index}` : key.label === '⌘' ? 'alt' : key.label === 'option' ? 'ctrl' : key.label,
}));

export function thinkDeck(): Maps {
  const ck = 'think-deck';
  if (!cache.has(ck)) {
    const colour = sheet(2048, 888, (ctx) => {
      ctx.scale(2, 2);
      ctx.fillStyle = '#111215';
      ctx.fillRect(0, 0, 1024, 444);
      for (const { x, y, w, h, label } of THINK_KEYS) {
        const cap = ctx.createLinearGradient(x, y, x, y + h);
        cap.addColorStop(0, '#44464b');
        cap.addColorStop(0.32, '#303237');
        cap.addColorStop(0.7, '#282a2e');
        cap.addColorStop(1, '#3a3c40');
        ctx.fillStyle = cap;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, [3, 3, 8, 8]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(188,193,203,0.18)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 2);
        ctx.lineTo(x + w - 5, y + 2);
        ctx.stroke();
        ctx.fillStyle = label === 'fn' ? '#8cb5db' : '#eef0f2';
        ctx.font = `${label.length > 2 ? 10 : 16}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = label.length > 2 ? 'left' : 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, label.length > 2 ? x + 6 : x + w / 2, y + h / 2, w - 10);
        if (label === 'F' || label === 'J') {
          ctx.fillStyle = '#92959b';
          ctx.fillRect(x + w / 2 - 6, y + h - 7, 12, 1.4);
        }
      }
    });
    cache.set(ck, clamped(tex(colour, 1, true)));
  }
  return { map: cache.get(ck) };
}

/**
 * The Tinkerbel's display, bezels and badges and all.
 *
 * Where the other machine's lid is nearly all screen, this one wears its frame
 * openly: a thumb of black either side, a shelf above it for a camera that has
 * a physical shutter, and a chin deep enough to put the maker's name on. That
 * chin is not a compromise on this machine, it is the house style — and it is
 * most of what tells the two lids apart from across a room, long before you
 * can read a word of it.
 */
export function thinkScreen(): Maps {
  const ck = 'think-screen';
  if (!cache.has(ck)) {
    const face = sheet(1024, 747, (ctx, w, h) => {
      const bezel = '#141416';
      ctx.fillStyle = bezel;
      ctx.fillRect(0, 0, w, h);

      const x0 = 30;
      const y0 = 36;
      const sw = w - 60;
      const sh = h - y0 - 82;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, sw, sh);
      ctx.clip();

      /* A desktop of the other persuasion: pale, cool, and blooming out of the
         middle, against the warm dark thing on the Nero. Two machines on one
         counter should not be showing the same picture. */
      const sky = ctx.createLinearGradient(x0, y0, x0 + sw * 0.3, y0 + sh);
      sky.addColorStop(0, '#cfe2ef');
      sky.addColorStop(0.55, '#dce9f2');
      sky.addColorStop(1, '#c6dcec');
      ctx.fillStyle = sky;
      ctx.fillRect(x0, y0, sw, sh);

      /*
       * The bloom: blades turned about one point, and it is the turning that
       * does it. Petals that keep their distance from the centre while the
       * angle runs round them open into a flower; petals that shrink toward
       * the same centre only nest, and what you get is a bullseye — which is
       * the difference between this and the first way I drew it.
       */
      const cx = x0 + sw * 0.54;
      const cy = y0 + sh * 0.56;
      const blades: Array<[number, number, string]> = [
        [-1.18, 0.47, '#2f6fd0'],
        [-0.82, 0.45, '#3f86dd'],
        [-0.46, 0.42, '#7e8ee2'],
        [-0.1, 0.39, '#d9679a'],
        [0.26, 0.35, '#e88fb0'],
        [0.62, 0.3, '#ef9d5e'],
        [0.98, 0.25, '#f6c88f'],
      ];
      ctx.filter = 'blur(3px)';
      for (const [turn, len, tint] of blades) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(turn);
        ctx.fillStyle = tint;
        ctx.globalAlpha = 0.72;
        ctx.beginPath();
        ctx.ellipse(0, -sh * len * 0.62, sh * len * 0.3, sh * len * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.filter = 'none';
      ctx.globalAlpha = 1;

      // the light coming off it, so the flat fill stops being a flat fill
      const gloss = ctx.createLinearGradient(x0, y0, x0 + sw * 0.6, y0 + sh);
      gloss.addColorStop(0, 'rgba(255,255,255,0.3)');
      gloss.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      gloss.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(x0, y0, sw, sh);

      // a bar along the bottom with its handful of things, in the middle
      const tb = y0 + sh - 34;
      ctx.fillStyle = 'rgba(245,250,253,0.72)';
      ctx.fillRect(x0, tb, sw, 34);
      const icons = ['#3f7fd0', '#5b9bd8', '#e4a04e', '#8aa4b8', '#5f8f6a', '#b96f8a'];
      icons.forEach((tint, i) => {
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.roundRect(cx - icons.length * 17 + i * 34 + 5, tb + 8, 19, 19, 5);
        ctx.fill();
      });
      ctx.restore();

      /* The camera shelf. A shutter you can actually slide is the detail this
         kind of machine is bought for, so it gets drawn even at this size. */
      ctx.fillStyle = '#0d0d0f';
      ctx.beginPath();
      ctx.roundRect(w / 2 - 96, 5, 192, y0 - 10, 6);
      ctx.fill();
      ctx.fillStyle = '#24262a';
      ctx.beginPath();
      ctx.arc(w / 2, y0 / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,170,200,0.55)';
      ctx.beginPath();
      ctx.arc(w / 2 - 2, y0 / 2 - 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a3d42';
      ctx.beginPath();
      ctx.roundRect(w / 2 + 34, y0 / 2 - 5, 26, 10, 3);
      ctx.fill();

      // the maker, bottom left, and what it is, bottom right
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#b9bcc2';
      ctx.font = '700 26px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Levona', x0 + 4, h - 42);
      ctx.fillStyle = '#6e7178';
      ctx.font = '600 20px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('TB14', w - x0 - 4, h - 42);
    });

    cache.set(ck, clamped(tex(face, 1, true)));
  }
  return { map: cache.get(ck) };
}

/**
 * The wordmark on the palm rest, with the light on its i.
 *
 * A cut-out card rather than paint on the case, because the case is one
 * extrusion and its UVs are in the units it was drawn in — fine for a grain
 * that tiles, useless for a word that has to land in one place at one size.
 */
export function tinkerMark(dark = false): THREE.Texture {
  const ck = dark ? 'tinker-mark-dark' : 'tinker-mark';
  if (!cache.has(ck)) {
    const c = sheet(512, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // A compact, slightly slanted wordmark with a precisely placed red i dot.
      ctx.font = 'italic 800 76px Arial, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = dark ? '#282a2e' : '#e9e9e7';
      const x = 12;
      const baseline = 88;
      ctx.fillText('TinkerBel', x, baseline);
      const dotX = x + ctx.measureText('T').width + ctx.measureText('i').width * 0.68;
      ctx.clearRect(dotX - 9, baseline - 60, 18, 17);
      ctx.fillStyle = '#dc342f';
      ctx.beginPath();
      ctx.arc(dotX, baseline - 53, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 13px Arial, sans-serif';
      ctx.letterSpacing = '3px';
      ctx.fillStyle = dark ? '#5c5e60' : '#93969c';
      ctx.fillText('LEVONA  /  TB14', x + 5, 115);
      ctx.letterSpacing = '0px';
    }, 0);
    cache.set(ck, clamped(tex(c, 1, true)));
  }
  return cache.get(ck)!;
}

/* ------------------------------------------------------------------ phone */

/** Warm titanium beneath glass, with sharp folded facets and cool edge glints. */
export function pearl(neutral = false): Maps {
  const ck = neutral ? 'pearl-neutral' : 'pearl';
  if (!cache.has(ck)) {
    const face = sheet(512, 1024, (ctx, w, h) => {
      const base = ctx.createLinearGradient(0, 0, w, h);
      base.addColorStop(0, '#c1bcb4');
      base.addColorStop(0.45, '#a59e94');
      base.addColorStop(1, '#777168');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const facets: Array<[number[], string, string]> = [
        [[0, 0.12, 1, 0.29, 0.62, 0.36], '#c9c5bf', '#8b867e'],
        [[1, 0.29, 0.62, 0.36, 1, 0.54], '#e1ddd7', '#99938b'],
        [[0, 0.57, 0.93, 0.86, 0.25, 0.88], '#868178', '#bcb7ae'],
        [[0, 0.57, 0.93, 0.86, 0.56, 1, 0, 1], '#aaa49a', '#69655f'],
        [[0.93, 0.86, 1, 0.9, 1, 1, 0.56, 1], '#b5b0a7', '#827b72'],
      ];
      for (const [points, from, to] of facets) {
        const gradient = ctx.createLinearGradient(0, h * points[1], w, h * points[points.length - 1]);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(points[0] * w, points[1] * h);
        for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i] * w, points[i + 1] * h);
        ctx.closePath();
        ctx.fill();
      }
      // Thin spectral seams stay sharp, like the reference's glass reflections.
      for (const [x1, y1, x2, y2] of [[0.68, 0.04, 1, 0.18], [0.64, 0.35, 1, 0.29], [0, 0.57, 0.93, 0.86]]) {
        const line = ctx.createLinearGradient(x1 * w, y1 * h, x2 * w, y2 * h);
        line.addColorStop(0, 'rgba(231,230,221,0.25)');
        line.addColorStop(0.55, 'rgba(169,219,237,0.8)');
        line.addColorStop(1, 'rgba(218,228,231,0.1)');
        ctx.strokeStyle = line;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x1 * w, y1 * h);
        ctx.lineTo(x2 * w, y2 * h);
        ctx.stroke();
      }
    });
    if (neutral) {
      // A neutral bright substrate keeps white white and avoids muddy color tints.
      const context = face.getContext('2d')!;
      const pixels = context.getImageData(0, 0, face.width, face.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luminance = pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722;
        const value = Math.min(255, 184 + (luminance - 100) * 0.56);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
    }
    cache.set(ck, clamped(tex(face, 1, true)));
  }
  return { map: cache.get(ck) };
}

/** Unbranded machined insert. Lens silhouettes belong to the model. */
export function lenses(): Maps {
  const ck = 'lenses';
  if (!cache.has(ck)) {
    const face = sheet(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#938d83';
      ctx.fillRect(0, 0, w, h);
      // Each diamond has a lit and shaded face, rather than a flat crosshatch.
      const pitch = 8;
      for (let y = -pitch; y < h + pitch; y += pitch) {
        for (let x = -pitch; x < w + pitch; x += pitch) {
          const cx = x + ((y / pitch) % 2 ? pitch / 2 : 0);
          ctx.fillStyle = '#beb8ad';
          ctx.beginPath();
          ctx.moveTo(cx, y - 4);
          ctx.lineTo(cx + 4, y);
          ctx.lineTo(cx, y + 4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#68645e';
          ctx.beginPath();
          ctx.moveTo(cx, y - 4);
          ctx.lineTo(cx - 4, y);
          ctx.lineTo(cx, y + 4);
          ctx.closePath();
          ctx.fill();
        }
      }
    });
    cache.set(ck, clamped(tex(face, 1, true)));
  }
  return { map: cache.get(ck) };
}

/** Optical coating shared by the three recessed glass discs. */
export function lensGlass(): Maps {
  const ck = 'lensGlass';
  if (!cache.has(ck)) {
    const face = sheet(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#090c10';
      ctx.fillRect(0, 0, w, h);
      const eye = ctx.createRadialGradient(w * 0.46, h * 0.45, 2, w / 2, h / 2, w * 0.26);
      eye.addColorStop(0, '#07121d');
      eye.addColorStop(0.45, '#132b40');
      eye.addColorStop(0.63, '#32333d');
      eye.addColorStop(0.76, '#15151b');
      eye.addColorStop(1, '#090c10');
      ctx.fillStyle = eye;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(186,215,240,0.8)';
      ctx.beginPath();
      ctx.ellipse(w * 0.42, h * 0.42, w * 0.045, h * 0.023, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,183,156,0.5)';
      ctx.beginPath();
      ctx.ellipse(w * 0.58, h * 0.57, w * 0.022, h * 0.035, -0.6, 0, Math.PI * 2);
      ctx.fill();
    });
    cache.set(ck, clamped(tex(face, 1, true)));
  }
  return { map: cache.get(ck) };
}

/** Everything above, dropped at once. */
export function disposeTextures() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
