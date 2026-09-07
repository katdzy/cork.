/**
 * Cork, generated.
 *
 * Real cork is a mat of compressed granules — irregular light and dark flecks
 * with darker seams between them. A tiling SVG of a few hundred rotated
 * ellipses gets much closer than any gradient stack, and it stays crisp at
 * every zoom level because it's vector.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRANULES = [
  // mid tones dominate; bright flecks are rare, the way real cork reads
  { fill: '#c1904f', op: 0.5 },
  { fill: '#b5854f', op: 0.5 },
  { fill: '#a2703a', op: 0.52 },
  { fill: '#cb9d5f', op: 0.42 },
  { fill: '#8d5c31', op: 0.46 },
  { fill: '#96683a', op: 0.5 },
  { fill: '#d8ab6d', op: 0.34 },
  { fill: '#6f4826', op: 0.36 },
  { fill: '#e8cb98', op: 0.2 },
];

function buildTile(size: number, count: number, seed: number, scale = 1) {
  const rnd = mulberry32(seed);
  const parts: string[] = [];

  for (let i = 0; i < count; i++) {
    const x = +(rnd() * size).toFixed(1);
    const y = +(rnd() * size).toFixed(1);
    const rx = +((3.4 + rnd() * 9) * scale).toFixed(1);
    const ry = +((2.2 + rnd() * 4.6) * scale).toFixed(1);
    const rot = Math.round(rnd() * 180);
    const g = GRANULES[Math.floor(rnd() * GRANULES.length)];
    parts.push(
      `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${g.fill}" opacity="${g.op}" transform="rotate(${rot} ${x} ${y})"/>`,
    );
  }

  // dark seams and tiny pits between the granules
  for (let i = 0; i < Math.round(count * 0.42); i++) {
    const x = +(rnd() * size).toFixed(1);
    const y = +(rnd() * size).toFixed(1);
    const r = +((0.5 + rnd() * 1.5) * scale).toFixed(1);
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#4f3115" opacity="${(0.18 + rnd() * 0.3).toFixed(2)}"/>`);
  }

  const group = parts.join('');
  const tiles = [-size, 0, size]
    .flatMap((dx) => [-size, 0, size].map((dy) => `<use href="#g" x="${dx}" y="${dy}"/>`))
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><g id="g">${group}</g></defs>${tiles}</svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Large soft patches — the uneven colour cork gets over a whole sheet. */
function buildMottle(size: number, seed: number) {
  const rnd = mulberry32(seed);
  const stops: string[] = [];
  const shapes: string[] = [];

  for (let i = 0; i < 7; i++) {
    const dark = rnd() > 0.45;
    const id = `m${seed}_${i}`;
    stops.push(
      `<radialGradient id="${id}"><stop offset="0%" stop-color="${dark ? '#5c3a18' : '#e6c288'}" stop-opacity="${(0.1 + rnd() * 0.12).toFixed(2)}"/><stop offset="100%" stop-color="${dark ? '#5c3a18' : '#e6c288'}" stop-opacity="0"/></radialGradient>`,
    );
    shapes.push(
      `<ellipse cx="${(rnd() * size).toFixed(0)}" cy="${(rnd() * size).toFixed(0)}" rx="${(size * (0.16 + rnd() * 0.2)).toFixed(0)}" ry="${(size * (0.12 + rnd() * 0.16)).toFixed(0)}" fill="url(#${id})"/>`,
    );
  }

  const group = shapes.join('');
  const tiles = [-size, 0, size]
    .flatMap((dx) => [-size, 0, size].map((dy) => `<use href="#p" x="${dx}" y="${dy}"/>`))
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs>${stops.join('')}<g id="p">${group}</g></defs>${tiles}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Old pin holes, left behind by everything that used to hang here. */
function buildHoles(size: number, seed: number, count: number) {
  const rnd = mulberry32(seed);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rnd() * size).toFixed(0);
    const y = (rnd() * size).toFixed(0);
    const r = (1.5 + rnd() * 1.6).toFixed(1);
    parts.push(
      `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${(+r * 0.85).toFixed(1)}" fill="#553venue" opacity="0.5"/>`,
    );
    parts.push(
      `<ellipse cx="${x}" cy="${+y + +r * 0.75}" rx="${(+r * 0.9).toFixed(1)}" ry="${(+r * 0.5).toFixed(1)}" fill="#eccb9e" opacity="0.32"/>`,
    );
  }
  const group = parts.join('').replace(/#553venue/g, '#513314');
  const tiles = [-size, 0, size]
    .flatMap((dx) => [-size, 0, size].map((dy) => `<use href="#h" x="${dx}" y="${dy}"/>`))
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><g id="h">${group}</g></defs>${tiles}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

let cached: { fine: string; coarse: string; mottle: string; holes: string } | null = null;

/**
 * Tilings at unrelated sizes, so the repeat never resolves into a pattern.
 * All of it is one background stack on one element — layered blend modes over
 * a board-sized surface are far too expensive to repaint while panning.
 */
export function corkTiles() {
  if (!cached) {
    cached = {
      fine: buildTile(320, 300, 20260907, 0.62),
      coarse: buildTile(487, 260, 7788, 1.25),
      mottle: buildMottle(941, 4242),
      holes: buildHoles(611, 991, 7),
    };
  }
  return cached;
}
