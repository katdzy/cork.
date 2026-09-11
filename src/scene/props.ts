import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COUNTER } from './layout';
import { foliage } from './parts';
import { bakeLight, mergeStatic } from './bake';
import { quality } from './quality';
import { anodised, keyboard, oak, screen, weave } from './textures';
import { finish, onPaint, type Finish } from './finish';

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
  get ceramic() {
    return (mats.ceramic ??= new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.36 }));
  },
  get clay() {
    return (mats.clay ??= new THREE.MeshStandardMaterial({ color: 0xd8c4ac, roughness: 0.72 }));
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

/* --------------------------------------------------------- rounded plates */

/**
 * A rectangle with its corners taken off, centred on the origin.
 *
 * Boxes are fine for a crate, which really is six boards nailed square. They
 * are not fine for a machined case, where the corner radius is most of what
 * the eye uses to date the object — square corners read as nineteen-nineties
 * whatever else is right about the shape.
 */
function rounded(w: number, h: number, r: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = w / 2;
  const y = h / 2;
  s.moveTo(cx - x + r, cy - y);
  s.lineTo(cx + x - r, cy - y);
  s.quadraticCurveTo(cx + x, cy - y, cx + x, cy - y + r);
  s.lineTo(cx + x, cy + y - r);
  s.quadraticCurveTo(cx + x, cy + y, cx + x - r, cy + y);
  s.lineTo(cx - x + r, cy + y);
  s.quadraticCurveTo(cx - x, cy + y, cx - x, cy + y - r);
  s.lineTo(cx - x, cy - y + r);
  s.quadraticCurveTo(cx - x, cy - y, cx - x + r, cy - y);
  return s;
}

/*
 * Three segments a corner, and no more.
 *
 * The trace shares its rays out by vertex, so every point spent on rounding is
 * a ray taken off the shading — and a twelve-segment corner at this size is
 * eleven vertices agreeing with each other. Three is where the silhouette
 * stops being a chamfer and starts being a radius; four is not visible.
 */
const SEGMENTS = 3;

/**
 * Crease, then weld.
 *
 * An extrusion arrives flat-shaded and unindexed, and both are wrong here. The
 * flat shading facets the corners it was built to round, and the missing index
 * quietly keeps the part out of the fold at the end of the bake — that pass
 * takes indexed geometry only, so an unindexed case is a draw call that never
 * gets merged away and is the more expensive of the two mistakes.
 *
 * Creasing at forty degrees fixes the first: the three chords of a corner are
 * thirty apart and smooth into one radius, while the right angle where the top
 * meets the side is ninety and stays the hard edge that catches the window.
 * Welding afterwards fixes the second, and pays for itself twice over, since
 * every vertex it takes out is rays handed back to the ones that are left.
 */
function knit(g: THREE.BufferGeometry) {
  const creased = toCreasedNormals(g, 0.7);
  const welded = mergeVertices(creased);
  creased.dispose();
  return welded;
}

/** A rounded plate, `w` by `d` in plan and `h` tall, standing on y = 0. */
function slab(
  w: number, d: number, h: number, r: number, m: THREE.Material,
  holes: Array<{ w: number; d: number; r: number; z?: number }> = [],
) {
  const shape = rounded(w, d, r);
  for (const hole of holes) shape.holes.push(rounded(hole.w, hole.d, hole.r, 0, hole.z ?? 0));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h, bevelEnabled: false, curveSegments: SEGMENTS,
  });
  // drawn in plan and extruded away from the viewer, so it is laid down and
  // stood back up: the shape's y becomes depth, and the extrusion becomes height
  g.rotateX(Math.PI / 2);
  g.translate(0, h, 0);
  return new THREE.Mesh(knit(g), m);
}

/**
 * The same outline with no thickness, for a face that carries a picture.
 *
 * A shape's UVs come out in the units it was drawn in, which is what makes an
 * extrusion's grain the same size on every part of the case; a screen is the
 * one surface where that is wrong, since the picture has to land on it exactly
 * once. So these are put back to nought-and-one, the way a plane's are.
 */
function panel(w: number, h: number, r: number, m: THREE.Material) {
  const g = new THREE.ShapeGeometry(rounded(w, h, r), SEGMENTS);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const at = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, at.getX(i) / w + 0.5, at.getY(i) / h + 0.5);
  }
  return new THREE.Mesh(g, m);
}

/* ----------------------------------------------------------------- props */

/**
 * How to put the finish on, left here by the laptop as it builds.
 *
 * The materials it closes over belong to one build of one room, and a rebuild
 * replaces them — so this is a slot rather than a list, and the stale pair
 * goes quietly wherever the geometry it was made for went.
 */
let coat: ((f: Finish) => void) | null = null;

/**
 * The Fujikey Nero, open on the counter.
 *
 * Everything here is the size the real thing is, at the three-to-one the rest
 * of the room is drawn at: three hundred and twelve millimetres across, ten
 * deep at the case, six through the lid. A laptop is the one object on this
 * counter everybody in the room owns, which means it is the one object where
 * being a centimetre out in any direction reads immediately as wrong, in a way
 * a mug two sizes too big never does.
 *
 * It is anodised aluminium, pale keys, and a dark bezel — which in a kitchen
 * of oak and cream is the difference between a machine somebody left open and
 * a black rectangle sitting on the worktop. Which anodising is the reader's,
 * and is the only thing about this prop that can change after it is built.
 *
 * The keyboard is not modelled. Seventy keys as seventy boxes would be a
 * thousand vertices, and because the trace shares its rays out by vertex, the
 * cost would not have landed on the laptop — it would have come off the light
 * on everything else standing on the wood. It is a picture instead, in a well
 * that is real: aluminium rails around a recess with the quad at the bottom of
 * it, so what darkens the keys is the shadow of the case they sit in rather
 * than a gradient painted on to suggest one.
 */
function laptop() {
  const g = new THREE.Group();
  const W = 960;
  const D = 676;
  const LID = 672;
  /** How far the aluminium stands above the well the keys sit in. */
  const RAIL = 8;
  const top = 36 + RAIL;
  /** Eight millimetres, which is about what the corners of one of these run to. */
  const R = 26;

  /* Anodising is a tint in the oxide rather than a coat of paint over it, so
     the colour has to survive being mostly reflection — which is why the
     metalness sits where it does. Take it much higher and the colour goes out
     of it; take it much lower and it stops being metal at all. The tooth under
     it is the blasting, which is the other half of why the real thing never
     looks like plastic. */
  const shell = new THREE.MeshStandardMaterial({
    roughness: 0.5, metalness: 0.5, envMapIntensity: 1.05, ...anodised(),
  });
  /* Glass over the same metal, so it is the body colour a shade down rather
     than a colour of its own — which is what a trackpad actually is. */
  const pane = new THREE.MeshStandardMaterial({
    roughness: 0.15, metalness: 0.32, envMapIntensity: 1.15,
  });
  coat = (f) => {
    shell.color.setHex(f.body);
    pane.color.setHex(f.body).multiplyScalar(0.95);
  };
  coat(finish());

  const inner = new THREE.MeshStandardMaterial({ color: 0x3a3c36, roughness: 0.66 });

  /* A plate under the case, inset all round. The gap it leaves is where the
     contact shadow goes, and a machine with one reads as standing on the
     counter rather than as printed on it. */
  part(g, slab(W - 52, D - 52, 6, R - 12, shell));
  const base = slab(W, D, 30, R, shell);
  base.position.y = 6;
  part(g, base);

  /* The top case, as one plate with the well and the trackpad cut out of it
     rather than as rails laid around a gap. The corner of a cut-out is the one
     corner on this machine you can see both sides of at once, and two rails
     meeting at right angles cannot give you it. */
  const deck = slab(W, D, RAIL, R, shell, [
    { w: 880, d: 362, r: 16, z: -139 },
    { w: 428, d: 248, r: 20, z: D / 2 - 148 },
  ]);
  deck.position.y = 36;
  part(g, deck);

  // the dark strip at the back that the lid folds down into
  part(g, bx(880, 4, 32, inner, 0, 38, -D / 2 + 34));

  const keys = new THREE.Mesh(new THREE.PlaneGeometry(880, 330), new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.82, ...keyboard(),
  }));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(0, 37, -D / 2 + 50 + 165);
  part(g, keys);

  /* Set down in its cut-out rather than laid on top of it. A trackpad is very
     nearly flush with the case, so what you actually find it by is the
     hairline of shadow round the edge — which needs an edge to fall down. */
  const pad = slab(420, 240, 6, 18, pane);
  pad.position.set(0, 36, D / 2 - 148);
  part(g, pad);

  /*
   * The lid, hinged at the back edge of the case.
   *
   * Bezel and display are one picture on one face rather than a dark panel set
   * into a light frame, because the seam between the two is exactly where the
   * eye goes: two surfaces a millimetre apart catch the window differently and
   * the join lights up. Painted together they share an edge exactly — and the
   * screen's corners can follow the lid's own radius in, which is the whole
   * reason a modern one looks machined rather than assembled.
   */
  const lid = new THREE.Group();
  const shut = new THREE.ExtrudeGeometry(rounded(W, LID, R - 2), {
    depth: 18, bevelEnabled: false, curveSegments: SEGMENTS,
  });
  shut.translate(0, 0, -9);
  const panelMesh = new THREE.Mesh(knit(shut), shell);
  panelMesh.position.y = LID / 2;
  part(lid, panelMesh);

  const lit = screen();
  const face = panel(W - 8, LID - 8, R - 6, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.14,
    envMapIntensity: 0.4,
    /* The screen is the only thing in either room that makes its own light.
       Lit off its own picture, so the wallpaper glows and the bezel, being
       almost black in the same picture, does not. */
    emissive: 0xffffff,
    emissiveIntensity: 0.26,
    emissiveMap: lit.map,
    ...lit,
  }));
  face.position.set(0, LID / 2, 10);
  part(lid, face);
  lid.position.set(0, top, -D / 2 + 9);
  lid.rotation.x = -0.26;
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
  { id: 'laptop', label: 'Fujikey Nero', x: -640, z: 940, rotation: 0.06, radius: 520, build: laptop },
  { id: 'books', label: 'Books', x: 480, z: 700, rotation: 0.12, radius: 400, build: books },
  { id: 'pens', label: 'Pens', x: 1200, z: 470, rotation: 0, radius: 160, build: pens },
  { id: 'crate', label: 'Crate', x: 2560, z: 1180, rotation: -0.16, radius: 340, build: crate },
  { id: 'herbs', label: 'Herbs', x: 3420, z: 820, rotation: 0, radius: 340, build: herbs },
];

export interface PlacedProp {
  def: PropDef;
  group: THREE.Group;
}

/**
 * Build every prop, put it where it belongs, and mark it as pickable.
 *
 * Each one is traced against itself before it goes in. The room's bake cannot
 * help here — a prop is the one thing in the scene that moves, so any
 * occlusion baked from its surroundings would be a lie the moment it was
 * picked up and put down somewhere else. What is true wherever it stands is
 * its own shape: the crease under a mug's handle, the dark inside a crate, the
 * gap between two books. Adding an implicit floor at its feet brings the last
 * one in — the contact shadow where it meets the wood — because the only place
 * a prop is ever put down is on a surface.
 *
 * Then it is folded to one mesh per material, like the room, but relative to
 * its own group so that it can still be carried around afterwards.
 */
export function buildProps(
  saved: Record<string, { x: number; z: number; rotation: number }>,
  settled: () => void,
): { group: THREE.Group; placed: PlacedProp[] } {
  const group = new THREE.Group();
  const placed: PlacedProp[] = [];
  // A prop is a few hundred vertices against a few hundred triangles, so its
  // share of the budget buys it a far finer trace than the same share buys a
  // wall. Nine of them still come to less than the room.
  const budget = Math.round(quality().rayBudget * 0.035);

  for (const def of PROPS) {
    const g = def.build();
    const at = saved[def.id];
    g.position.set(at?.x ?? def.x, COUNTER.top, at?.z ?? def.z);
    g.rotation.y = at?.rotation ?? def.rotation;

    bakeLight(g, {
      rayBudget: budget,
      ground: COUNTER.top,
      floor: 0.42,
      bleed: 0.35,
      settled: () => {
        mergeStatic(g);
        /* The merge replaces the meshes, so the id they are picked by has to
           go on again — a prop nobody can grab is a worse bug than a prop
           that takes a moment to shade. */
        g.traverse((o) => {
          o.userData.propId = def.id;
        });
        settled();
      },
    });

    g.userData.propId = def.id;
    g.traverse((o) => {
      o.userData.propId = def.id;
    });
    group.add(g);
    placed.push({ def, group: g });
  }

  /* Recolouring is one uniform and no rebuild — but the room is drawn on
     demand, so putting the colour on and asking for the frame that would show
     it are two separate things, and a change made while nothing else is
     moving needs both or it waits for the next time somebody touches the
     camera. */
  onPaint((f) => {
    coat?.(f);
    settled();
  });

  return { group, placed };
}
