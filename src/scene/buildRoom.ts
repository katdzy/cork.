import * as THREE from 'three';
import { CABINET, COUNTER, ROOM, WINDOW } from './layout';
import { box, panel, pierced, still } from './parts';
import { brushed, oak, plaster } from './textures';

/**
 * The shell: plaster, floor, ceiling, the window that lights it all, and the
 * butcher block over shaker cabinets that everything else stands on.
 *
 * Built once into a static group. None of it moves, so it is all marked as
 * such — three.js then skips re-deriving world matrices for it every frame,
 * which over a hundred-odd meshes is most of a millisecond back. Afterwards
 * `themes.ts` traces the lighting into its vertices and folds the whole thing
 * down to one mesh per material, so what leaves here is a description rather
 * than a scene graph.
 */

/** Blown-out daylight with a suggestion of a garden in it. */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.52, '#fbfdf6');
  g.addColorStop(1, '#e9f0dc');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  // foliage, thrown far out of focus by a lens that is exposed for indoors
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 256;
    const y = 180 + Math.random() * 360;
    const r = 20 + Math.random() * 70;
    const rad = ctx.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, `rgba(${120 + Math.random() * 60},${160 + Math.random() * 50},${90 + Math.random() * 50},0.5)`);
    rad.addColorStop(1, 'rgba(150,180,110,0)');
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildRoom(): THREE.Group {
  const group = new THREE.Group();
  const plas = plaster();

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xe6dccd,
    roughness: 0.94,
    metalness: 0,
    ...plas,
    normalScale: new THREE.Vector2(0.34, 0.34),
  });

  const W = ROOM.halfWidth * 2;
  const H = ROOM.height;
  const D = ROOM.depth;

  /* -- back wall ------------------------------------------------------- */
  const back = panel(W, H, wallMat);
  back.position.set(0, H / 2, 0);
  group.add(still(back));

  /* -- side walls; the right one has the window cut out of it ----------- */
  const left = panel(D, H, wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-ROOM.halfWidth, H / 2, D / 2);
  group.add(still(left));

  const hole = new THREE.Box2(
    new THREE.Vector2(WINDOW.near - D / 2, WINDOW.bottom - H / 2),
    new THREE.Vector2(WINDOW.far - D / 2, WINDOW.top - H / 2),
  );
  const right = new THREE.Mesh(pierced(D, H, hole), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(ROOM.halfWidth, H / 2, D / 2);
  right.receiveShadow = true;
  group.add(still(right));

  /* -- floor and ceiling ------------------------------------------------ */
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0,
    ...oak('floor', { light: '#c79a68', dark: '#6b4526', repeat: 5, bump: 2.6, seed: 771 }),
  });
  const floor = panel(W, D, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, D / 2);
  group.add(still(floor));

  const ceil = panel(W, D, new THREE.MeshStandardMaterial({ color: 0xf3eee6, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, D / 2);
  group.add(still(ceil));

  /* -- the window ------------------------------------------------------- */
  const paint = new THREE.MeshStandardMaterial({
    color: 0xfbf8f2,
    roughness: 0.42,
    metalness: 0,
    // eggshell on a cabinet door holds a soft image of the window; flat white
    // paint is the one thing in a kitchen that never happens
    envMapIntensity: 1,
  });
  const wH = WINDOW.top - WINDOW.bottom;
  const wD = WINDOW.far - WINDOW.near;
  const wZ = (WINDOW.near + WINDOW.far) / 2;
  const wY = (WINDOW.bottom + WINDOW.top) / 2;
  const x = ROOM.halfWidth;

  // the glass, sitting a little outside the wall, doing the lighting
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(wD, wH),
    new THREE.MeshBasicMaterial({ map: skyTexture(), toneMapped: false }),
  );
  sky.rotation.y = -Math.PI / 2;
  sky.position.set(x + 90, wY, wZ);
  group.add(still(sky));

  // reveal and frame
  const jambMat = paint;
  group.add(still(box(WINDOW.reveal, wH + 220, 110, jambMat, x - WINDOW.reveal / 2, wY, WINDOW.near - 55)));
  group.add(still(box(WINDOW.reveal, wH + 220, 110, jambMat, x - WINDOW.reveal / 2, wY, WINDOW.far + 55)));
  group.add(still(box(WINDOW.reveal, 110, wD + 220, jambMat, x - WINDOW.reveal / 2, WINDOW.top + 55, wZ)));
  // the sill, which is the one part of a window you actually look at
  group.add(still(box(WINDOW.reveal + 190, 90, wD + 260, jambMat, x - (WINDOW.reveal + 190) / 2 + 60, WINDOW.bottom - 45, wZ)));
  // a single glazing bar, so it reads as a window rather than a lightbox
  group.add(still(box(70, 46, wD, jambMat, x - 40, wY + wH * 0.06, wZ)));

  /* -- counter and cabinets --------------------------------------------- */
  const oakCounter = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0,
    // oiled butcher block: the sheen down the length of it is the window
    envMapIntensity: 1.5,
    ...oak('counter', { light: '#c9975e', dark: '#7f5223', repeat: 3.4, bump: 1.1, seed: 313 }),
  });
  const top = box(W, COUNTER.thickness, COUNTER.depth, oakCounter, 0, COUNTER.top - COUNTER.thickness / 2, COUNTER.depth / 2);
  group.add(still(top));

  // carcass
  group.add(still(box(W, CABINET.top - CABINET.toeKick, CABINET.depth, paint,
    0, (CABINET.top + CABINET.toeKick) / 2, CABINET.depth / 2 - 40)));
  group.add(still(box(W, CABINET.toeKick, CABINET.depth - 220, new THREE.MeshStandardMaterial({ color: 0xdfd8cc, roughness: 0.8 }),
    0, CABINET.toeKick / 2, (CABINET.depth - 220) / 2)));

  // shaker doors: a flat panel with a proud frame around it
  const doorW = 1560;
  const gap = 34;
  const faceZ = CABINET.depth - 40;
  const doorH = CABINET.top - CABINET.toeKick - 90;
  const doorY = (CABINET.top + CABINET.toeKick) / 2;
  const count = Math.floor(W / (doorW + gap));
  const startX = -((count - 1) * (doorW + gap)) / 2;

  /* One material for every pull, not one each. Identical materials that are
     not the *same* material are five separate draw calls that the merge cannot
     fold together, because what it batches by is material identity. */
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb08d4e,
    roughness: 0.32,
    metalness: 0.85,
    /* The surface in this room with most to gain from the captured
       reflection. Brushed rather than polished: a mirror-smooth pull reflects
       the probe's own viewpoint, which is right from the one place in the room
       it was taken from and wrong from everywhere else. */
    envMapIntensity: 2.4,
    ...brushed(),
    normalScale: new THREE.Vector2(0.5, 0.5),
  });

  for (let i = 0; i < count; i++) {
    const dx = startX + i * (doorW + gap);
    const rail = 150;
    const stile = 150;
    for (const [w, h, ox, oy] of [
      [doorW, rail, 0, doorH / 2 - rail / 2],
      [doorW, rail, 0, -doorH / 2 + rail / 2],
      [stile, doorH - rail * 2, -doorW / 2 + stile / 2, 0],
      [stile, doorH - rail * 2, doorW / 2 - stile / 2, 0],
    ]) {
      group.add(still(box(w, h, 46, paint, dx + ox, doorY + oy, faceZ + 23)));
    }
    // a brass cup pull, like the reference
    group.add(still(box(230, 62, 60, brass, dx, doorY + doorH / 2 - 260, faceZ + 60)));
  }

  return group;
}
