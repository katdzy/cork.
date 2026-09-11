import * as THREE from 'three';
import { BOARD, HOOKS, RACK } from './layout';
import { box, foliage, still } from './parts';
import { cork, oak, paper, weave } from './textures';

/**
 * What else is on the wall: the mail rack, the hook rail with the keys on it,
 * a basket of trailing greenery, and the frame the corkboard sits in.
 *
 * The frame is real geometry rather than a CSS border, which is the whole
 * reason the board survives being orbited — a border painted on a plane goes
 * flat the moment you look at it from the side, where a moulding with actual
 * depth catches the window down one edge and shades the other.
 */

/* ------------------------------------------------------------ stencilling */

/** A stencilled word on a transparent card, for the fronts of the pockets. */
function labelTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4ece0';
  ctx.font = '600 62px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '14px';
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f2e8';
  ctx.fillRect(0, 0, 384, 512);
  ctx.fillStyle = '#3c3128';
  ctx.textAlign = 'center';
  ctx.font = '600 96px Caveat, ui-serif, cursive';
  ctx.fillText('family', 192, 190);
  ctx.font = '600 30px ui-sans-serif, system-ui, sans-serif';
  ctx.letterSpacing = '3px';
  for (const [i, line] of ['A LITTLE BIT', 'OF CRAZY', 'A LITTLE BIT', 'OF LOUD &', 'A WHOLE LOT', 'OF LOVE'].entries()) {
    ctx.fillText(line, 192, 268 + i * 40);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* -------------------------------------------------------------- fittings */

export function buildFittings(): THREE.Group {
  const g = new THREE.Group();

  const rustic = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    ...oak('rustic', { light: '#b28459', dark: '#6d4c2e', repeat: 2.1, bump: 2.4, seed: 5501 }),
  });
  const darkOak = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    ...oak('frame', { light: '#9a6b41', dark: '#402816', repeat: 1, bump: 2.0, seed: 88 }),
  });

  /* -- the corkboard's frame, and the panel the DOM sheet lies on -------- */
  const f = 96;
  const fw = BOARD.width + f * 2;
  const fh = BOARD.height + f * 2;
  const cx = BOARD.centreX;
  const cy = BOARD.centreY;
  for (const [w, h, ox, oy] of [
    [fw, f, 0, fh / 2 - f / 2],
    [fw, f, 0, -fh / 2 + f / 2],
    [f, fh - f * 2, -fw / 2 + f / 2, 0],
    [f, fh - f * 2, fw / 2 - f / 2, 0],
  ]) {
    g.add(still(box(w, h, 88, darkOak, cx + ox, cy + oy, BOARD.z + 20)));
  }
  // The cork itself, in the room rather than in the DOM. Its front face sits
  // just behind the plane the memories are placed on, inside the moulding.
  g.add(still(box(BOARD.width, BOARD.height, 44, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    ...cork(),
    normalScale: new THREE.Vector2(0.85, 0.85),
  }), cx, cy, BOARD.z - 28)));

  /* -- the mail rack ---------------------------------------------------- */
  const rx = RACK.left + RACK.width / 2;
  const ry = RACK.bottom + RACK.height / 2;
  g.add(still(box(RACK.width, RACK.height, 56, rustic, rx, ry, 28)));

  const pocketH = 620;
  const pockets: Array<[number, string]> = [
    [RACK.bottom + RACK.height - pocketH - 210, 'MAIL'],
    [RACK.bottom + 250, 'TO DO'],
  ];
  for (const [py, text] of pockets) {
    const front = box(RACK.width, pocketH, 46, rustic, rx, py + pocketH / 2, RACK.depth);
    g.add(still(front));
    g.add(still(box(RACK.width, 46, RACK.depth, rustic, rx, py, RACK.depth / 2)));
    for (const side of [-1, 1]) {
      g.add(still(box(46, pocketH, RACK.depth, rustic, rx + side * (RACK.width / 2 - 23), py + pocketH / 2, RACK.depth / 2)));
    }

    // Stood a clear centimetre off the pocket face. At one unit it shared a
    // depth value with the wood and the two of them took turns winning.
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(RACK.width * 0.62, RACK.width * 0.62 * 0.25),
      new THREE.MeshStandardMaterial({ map: labelTexture(text), alphaTest: 0.4, roughness: 0.9 }),
    );
    label.position.set(rx, py + pocketH * 0.42, RACK.depth + 46);
    g.add(still(label));

    // Post, at the angles post always ends up at. Uniform envelopes read as a
    // single white bar laid across the rack; it is the raggedness of the tops
    // that says these are separate things somebody pushed in one at a time.
    const paperMat = (c: number, rough: number) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: rough, ...paper() });
    const post: Array<[number, number, number, number, number]> = [
      // colour, width fraction, height, x nudge, lean
      [0xf4ecdc, 0.74, 520, -140, -0.16],
      [0xccd6df, 0.58, 430, 120, -0.09],
      [0xdcc094, 0.66, 600, -40, -0.2],
      [0xf7f2e6, 0.48, 380, 260, -0.06],
      [0xe4d6c2, 0.7, 470, 30, -0.13],
    ];
    post.forEach(([c, frac, h, nudge, lean], i) => {
      const e = box(RACK.width * frac, h, 14, paperMat(c, 0.9 + (i % 2) * 0.05),
        rx + nudge, py + h * 0.46, RACK.depth * 0.34 + i * 20);
      e.rotation.set(lean, (i - 2) * 0.04, (i - 2) * 0.018);
      g.add(still(e));
    });
  }

  /* -- the hook rail ---------------------------------------------------- */
  const black = new THREE.MeshStandardMaterial({ color: 0x22201e, roughness: 0.42, metalness: 0.2 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xba9251, roughness: 0.28, metalness: 0.9 });
  g.add(still(box(HOOKS.width, HOOKS.height, 40, black, HOOKS.left + HOOKS.width / 2, HOOKS.y, 20)));

  for (let i = 0; i < 4; i++) {
    const hx = HOOKS.left + HOOKS.width * (0.16 + i * 0.23);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 120, 8), brass);
    stem.position.set(hx, HOOKS.y + 10, 90);
    stem.rotation.x = Math.PI / 2;
    stem.castShadow = true;
    g.add(still(stem));
    const curl = new THREE.Mesh(new THREE.TorusGeometry(52, 18, 6, 14, Math.PI), brass);
    curl.position.set(hx, HOOKS.y - 44, 140);
    curl.rotation.set(0, 0, Math.PI);
    curl.castShadow = true;
    g.add(still(curl));
  }

  // keys, on the second hook
  const kx = HOOKS.left + HOOKS.width * 0.39;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(64, 11, 6, 18), brass);
  ring.position.set(kx, HOOKS.y - 118, 140);
  ring.castShadow = true;
  g.add(still(ring));
  [-0.22, 0.16].forEach((tilt, i) => {
    const k = box(52, 240, 12, i ? brass : new THREE.MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.35, metalness: 0.9 }),
      kx + tilt * 150, HOOKS.y - 290, 140);
    k.rotation.z = tilt;
    g.add(still(k));
  });

  /* -- a basket of greenery, hanging off the end of the rail ------------ */
  const bx = HOOKS.left + HOOKS.width + 760;
  const by = HOOKS.y + 620;
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(330, 250, 400, 20, 1, true),
    new THREE.MeshStandardMaterial({ ...weave(), roughness: 0.94, side: THREE.DoubleSide }),
  );
  basket.position.set(bx, by, 330);
  basket.castShadow = true;
  g.add(still(basket));
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(250, 20), new THREE.MeshStandardMaterial({ ...weave(), roughness: 0.94 }));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(bx, by - 200, 330);
  g.add(still(bottom));

  const green = foliage(9, 620, 760, 260);
  green.position.set(bx, by + 150, 330);
  g.add(green);

  // the peg it hangs from
  g.add(still(box(46, 46, 240, darkOak, bx, by + 470, 120)));
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 300, 5), new THREE.MeshStandardMaterial({ color: 0x9a8560, roughness: 1 }));
  cord.position.set(bx, by + 330, 300);
  cord.rotation.z = -0.32;
  g.add(still(cord));

  /* -- the framed sign, leaning where the counter meets the wall -------- */
  const sign = new THREE.Group();
  const sw = 1020;
  const sh = 1320;
  const sf = 74;
  for (const [w, h, ox, oy] of [
    [sw, sf, 0, sh / 2 - sf / 2],
    [sw, sf, 0, -sh / 2 + sf / 2],
    [sf, sh - sf * 2, -sw / 2 + sf / 2, 0],
    [sf, sh - sf * 2, sw / 2 - sf / 2, 0],
  ]) {
    sign.add(box(w, h, 60, darkOak, ox, oy, 0));
  }
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(sw - sf * 2, sh - sf * 2),
    new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.9 }),
  );
  face.position.z = 6;
  sign.add(face);
  sign.position.set(1780, 2760 + sh / 2, 520);
  sign.rotation.x = 0.085;
  g.add(sign);

  return g;
}
