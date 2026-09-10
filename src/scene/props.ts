import * as THREE from 'three';
import { COUNTER } from './layout';
import { foliage } from './parts';
import { oak, weave } from './textures';

/**
 * The things on the counter, which are the things you can pick up and move.
 *
 * Each is a small group with its origin on the counter surface, so placing one
 * is only ever setting x and z — a dragged object stays sitting on the wood
 * instead of sinking into it or floating, without any of them having to know
 * how tall they are.
 */

export interface PropDef {
  id: string;
  label: string;
  /** Where it sits before anyone moves it, and how much room it needs. */
  x: number;
  z: number;
  rotation: number;
  radius: number;
  build(): THREE.Group;
}

const shared = {
  get aluminium() {
    return (mats.aluminium ??= new THREE.MeshStandardMaterial({ color: 0xbfc3c7, roughness: 0.34, metalness: 0.82 }));
  },
  get ceramic() {
    return (mats.ceramic ??= new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.36 }));
  },
  get clay() {
    return (mats.clay ??= new THREE.MeshStandardMaterial({ color: 0xd8c4ac, roughness: 0.72 }));
  },
  get screen() {
    return (mats.screen ??= new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.18, metalness: 0.1 }));
  },
};
const mats: Record<string, THREE.MeshStandardMaterial> = {};

function part(g: THREE.Group, mesh: THREE.Mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

const bx = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};

const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 20) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

/* ----------------------------------------------------------------- props */

function laptop() {
  const g = new THREE.Group();
  const w = 950;
  const d = 660;
  part(g, bx(w, 46, d, shared.aluminium, 0, 23, 0));
  // the deck, a shade darker than the lid so the machine has a top and a front
  part(g, bx(w - 90, 8, d - 110, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5 }), 0, 48, 24));
  const lid = new THREE.Group();
  const screen = bx(w, 620, 30, shared.aluminium, 0, 310, 0);
  part(lid, screen);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 70, 550), shared.screen);
  face.position.set(0, 310, 17);
  lid.add(face);
  lid.position.set(0, 44, -d / 2 + 20);
  lid.rotation.x = -0.28;
  g.add(lid);
  return g;
}

function books() {
  const g = new THREE.Group();
  const tints = [0x6d5545, 0x8a6a4a, 0x4d5a4f, 0x9a7a5c];
  let y = 0;
  tints.forEach((c, i) => {
    const h = 78 - i * 6;
    const w = 720 - i * 44;
    const d = 500 - i * 28;
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.78 });
    const b = part(g, bx(w, h, d, mat, (i % 2 ? 1 : -1) * 14, y + h / 2, (i % 2 ? -1 : 1) * 12));
    b.rotation.y = (i % 2 ? 1 : -1) * 0.045;
    // the page block, set in from the spine
    const pages = bx(w - 40, h - 22, d - 30, new THREE.MeshStandardMaterial({ color: 0xe8dfcd, roughness: 0.95 }),
      (i % 2 ? 1 : -1) * 14 + 14, y + h / 2, (i % 2 ? -1 : 1) * 12);
    pages.rotation.y = b.rotation.y;
    part(g, pages);
    y += h;
  });
  return g;
}

function mug() {
  const g = new THREE.Group();
  const body = part(g, cyl(150, 128, 300, shared.ceramic));
  body.position.y = 150;
  const rim = part(g, new THREE.Mesh(new THREE.TorusGeometry(148, 12, 6, 20), shared.ceramic));
  rim.position.y = 300;
  rim.rotation.x = Math.PI / 2;
  const handle = part(g, new THREE.Mesh(new THREE.TorusGeometry(92, 22, 6, 16, Math.PI * 1.25), shared.ceramic));
  handle.position.set(168, 168, 0);
  handle.rotation.z = -0.4;
  const coffee = part(g, cyl(134, 134, 6, new THREE.MeshStandardMaterial({ color: 0x33200f, roughness: 0.24 })));
  coffee.position.y = 282;
  return g;
}

function candle() {
  const g = new THREE.Group();
  const glass = part(g, cyl(160, 150, 260, new THREE.MeshStandardMaterial({
    color: 0x5b3312, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.86,
  })));
  glass.position.y = 130;
  const wax = part(g, cyl(146, 146, 40, new THREE.MeshStandardMaterial({ color: 0xe8d9bc, roughness: 0.8 })));
  wax.position.y = 214;
  return g;
}

function tray() {
  const g = new THREE.Group();
  const w = weave();
  const mat = new THREE.MeshStandardMaterial({ ...w, roughness: 0.95, side: THREE.DoubleSide });
  const wall = part(g, cyl(390, 350, 150, mat, 24));
  wall.position.y = 75;
  const base = part(g, new THREE.Mesh(new THREE.CircleGeometry(350, 24), mat));
  base.rotation.x = -Math.PI / 2;
  base.position.y = 6;
  return g;
}

function pens() {
  const g = new THREE.Group();
  const cup = part(g, cyl(130, 120, 280, shared.ceramic));
  cup.position.y = 140;
  const colours = [0x2b2b2f, 0x8a3b2c, 0x2f4256, 0x5a5f66];
  colours.forEach((c, i) => {
    const p = part(g, cyl(14, 14, 420, new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }), 6));
    p.position.set((i - 1.5) * 42, 320, (i % 2 ? 1 : -1) * 32);
    p.rotation.z = (i - 1.5) * 0.08;
    p.rotation.x = (i % 2 ? 1 : -1) * 0.06;
  });
  return g;
}

function herbs() {
  const g = new THREE.Group();
  const pot = part(g, cyl(310, 250, 400, shared.ceramic));
  pot.position.y = 200;
  const soil = part(g, cyl(292, 292, 14, new THREE.MeshStandardMaterial({ color: 0x3c2c20, roughness: 1 })));
  soil.position.y = 396;
  const leaves = foliage(8, 480, 620);
  leaves.position.y = 400;
  g.add(leaves);
  return g;
}

function branches() {
  const g = new THREE.Group();
  const vase = part(g, cyl(180, 210, 620, shared.clay));
  vase.position.y = 310;
  const neck = part(g, cyl(140, 180, 90, shared.clay));
  neck.position.y = 660;
  const leaves = foliage(7, 620, 1150, 60);
  leaves.position.y = 700;
  g.add(leaves);
  return g;
}

function crate() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    ...oak('crate', { light: '#b5875a', dark: '#54341b', repeat: 1, bump: 2.6, seed: 66 }),
  });
  for (const [w, h, d, x, y, z] of [
    [560, 40, 420, 0, 20, 0],
    [560, 170, 40, 0, 105, -190],
    [560, 170, 40, 0, 105, 190],
    [40, 170, 420, -260, 105, 0],
    [40, 170, 420, 260, 105, 0],
  ]) {
    part(g, bx(w, h, d, mat, x, y, z));
  }
  return g;
}

/**
 * Where everything starts, arranged to the reference: the greenery at the two
 * ends, the small warm things in the middle, and the counter left open in
 * front of the board so the board is never the thing that gets crowded out.
 */
export const PROPS: readonly PropDef[] = [
  { id: 'branches', label: 'Eucalyptus', x: -3560, z: 760, rotation: 0.2, radius: 420, build: branches },
  { id: 'tray', label: 'Woven tray', x: -2820, z: 600, rotation: 0, radius: 400, build: tray },
  { id: 'candle', label: 'Candle', x: -2280, z: 520, rotation: 0, radius: 180, build: candle },
  { id: 'mug', label: 'Mug', x: -1780, z: 720, rotation: -0.5, radius: 220, build: mug },
  { id: 'laptop', label: 'Laptop', x: -640, z: 940, rotation: 0.06, radius: 520, build: laptop },
  { id: 'books', label: 'Books', x: 480, z: 700, rotation: 0.12, radius: 400, build: books },
  { id: 'pens', label: 'Pens', x: 1200, z: 470, rotation: 0, radius: 160, build: pens },
  { id: 'crate', label: 'Crate', x: 2560, z: 1180, rotation: -0.16, radius: 340, build: crate },
  { id: 'herbs', label: 'Herbs', x: 3420, z: 820, rotation: 0, radius: 340, build: herbs },
];

export interface PlacedProp {
  def: PropDef;
  group: THREE.Group;
}

/** Build every prop, put it where it belongs, and mark it as pickable. */
export function buildProps(saved: Record<string, { x: number; z: number; rotation: number }>): {
  group: THREE.Group;
  placed: PlacedProp[];
} {
  const group = new THREE.Group();
  const placed: PlacedProp[] = [];
  for (const def of PROPS) {
    const g = def.build();
    const at = saved[def.id];
    g.position.set(at?.x ?? def.x, COUNTER.top, at?.z ?? def.z);
    g.rotation.y = at?.rotation ?? def.rotation;
    g.userData.propId = def.id;
    g.traverse((o) => {
      o.userData.propId = def.id;
    });
    group.add(g);
    placed.push({ def, group: g });
  }
  return { group, placed };
}
