import * as THREE from 'three';
import { arc, box, seg, still } from './parts';
import { crinkle, grime, paper } from './textures';
import { quality } from './quality';

/**
 * The pile the board was left beside.
 *
 * This is the first thing the opening shows and it has about eight seconds to
 * be believed, so what matters is not how much rubbish there is but that no
 * two pieces of it are the same piece. The version this replaced was seven
 * spheres and a cone each, in one colour, at one size — which the eye reads
 * instantly and correctly as seven spheres.
 *
 * So: every bag is its own geometry, slumped under its own weight, pushed out
 * of shape by whatever is inside it and gathered into a knot that was tied by
 * hand. Around them go the things that are actually on a kerb at collection
 * time — flattened cartons leaning on the wall, a crate, a bundle of papers
 * someone tied, and the litter that gets away. Nothing here is symmetrical and
 * nothing is level.
 */

/** Deterministic noise, so the pile is the same pile on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * One bin bag, deformed from a sphere into something that has been filled.
 *
 * Everything done to the sphere here is something that happens to a bag. It
 * slumps, so it is widest low down and the bottom has spread where it meets
 * the pavement. Its contents press out, as a few soft lobes and one hard
 * corner — a box inside a bag is the most recognisable shape in a pile of
 * rubbish. It is gathered at the neck, which twists what is below it round as
 * it goes. And it is folded: a handful of deep folds that show in silhouette,
 * over a fine crease everywhere, which together are what stop the highlight
 * running across it in one unbroken piece and giving the sphere away.
 */
function sackGeometry(seed: number): THREE.BufferGeometry {
  const rnd = rng(seed);
  const rings = quality().tier === 'low' ? 18 : 30;
  const geometry = new THREE.SphereGeometry(1, rings, Math.round(rings * 0.72));
  const position = geometry.attributes.position;
  const direction = (spread: number) =>
    new THREE.Vector3(rnd() * 2 - 1, (rnd() * 2 - 1) * spread, rnd() * 2 - 1).normalize();
  const lobes = [
    { at: direction(0.8), size: 0.18 + rnd() * 0.16 },
    { at: direction(0.8), size: 0.16 + rnd() * 0.18 },
    { at: direction(1), size: 0.12 + rnd() * 0.16 },
  ];
  // The big folds, which are the ones that show in silhouette: plastic
  // gathers into a handful of them, heaviest where the bag sits down.
  const folds = 3 + Math.floor(rnd() * 3);
  const phase = rnd() * 7;
  const corner = direction(0.5);
  const twist = 0.4 + rnd() * 0.8;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const up = (v.y + 1) / 2;
    let radius = 1.1 - 0.34 * up * up;
    for (const lobe of lobes) radius += lobe.size * Math.max(0, v.dot(lobe.at)) ** 2;
    radius += 0.2 * Math.max(0, v.dot(corner)) ** 12;
    // The neck is short: plastic gathered in a fist, not drawn out to a point.
    const neck = smoothstep(0.8, 1, up);
    radius *= 1 - 0.72 * neck;
    const angle = Math.atan2(v.z, v.x) + twist * neck;
    const flat = Math.hypot(v.x, v.z) * radius;
    // Weight above squashes the bottom rather than cutting it off flat.
    let y = v.y;
    if (y < -0.42) y = -0.42 + (y + 0.42) * 0.46;
    const gathered = smoothstep(0.75, 0.05, up);
    const crease = 1
      + 0.075 * Math.sin(angle * folds + phase + v.y * 1.4) * gathered
      + 0.022 * Math.sin(angle * 9 + v.y * 5) * (0.4 + neck * 1.4);
    position.setXYZ(i, Math.cos(angle) * flat * crease, y * 0.98, Math.sin(angle) * flat * crease);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** The tail of a knot: gathered plastic, twisted once and left leaning. */
function knot(material: THREE.Material, radius: number) {
  const group = new THREE.Group();
  const gather = new THREE.Mesh(new THREE.SphereGeometry(1, arc(12), arc(9)), material);
  gather.scale.set(radius * 0.19, radius * 0.11, radius * 0.19);
  group.add(gather);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(1, arc(10), arc(8)), material);
  tail.scale.set(radius * 0.17, radius * 0.07, radius * 0.1);
  tail.position.set(radius * 0.12, radius * 0.07, radius * 0.04);
  tail.rotation.set(0.3, 0.4, 0.75);
  group.add(tail);
  group.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return group;
}

function sack(
  seed: number,
  material: THREE.Material,
  radius: number,
  { x, z, y = 0, tilt = 0, roll = 0, squash = 1 }:
    { x: number; z: number; y?: number; tilt?: number; roll?: number; squash?: number },
) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(sackGeometry(seed), material);
  mesh.scale.set(radius, radius * squash, radius * 0.94);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  const tie = knot(material, radius);
  tie.position.y = radius * squash * 0.9;
  group.add(tie);
  group.position.set(x, y + radius * squash * 0.46, z);
  group.rotation.set(tilt, seed % 6, roll);
  return still(group);
}

/**
 * A carton, with walls that have a thickness and flaps that were bent open.
 *
 * Boxes on a kerb are never shut and never square. The flaps take an angle
 * each, the whole thing gets a shove out of true, and one wall is allowed to
 * lean in — which is all it takes for a box to look emptied rather than
 * modelled.
 */
function carton(
  w: number,
  h: number,
  d: number,
  kraft: THREE.Material,
  tape: THREE.Material,
  flaps: [number, number, number, number],
  seed = 3,
) {
  const rnd = rng(seed);
  const group = new THREE.Group();
  const wall = 22;
  group.add(box(w, wall, d, kraft, 0, wall / 2, 0));
  const sides: Array<[number, number, number, number, number]> = [
    // width, depth, x, z, which flap
    [w, wall, 0, -d / 2 + wall / 2, 0],
    [w, wall, 0, d / 2 - wall / 2, 1],
    [wall, d - wall * 2, -w / 2 + wall / 2, 0, 2],
    [wall, d - wall * 2, w / 2 - wall / 2, 0, 3],
  ];
  for (const [sw, sd, x, z, index] of sides) {
    const panel = box(sw, h, sd, kraft, x, h / 2, z);
    panel.rotation.x = index < 2 ? (rnd() - 0.5) * 0.06 : 0;
    group.add(panel);
    // The flap hangs off the top edge of its own wall, so it bends with it.
    const hinge = new THREE.Group();
    hinge.position.set(x, h, z);
    hinge.rotation.y = index < 2 ? 0 : Math.PI / 2;
    const long = index < 2 ? sw : sd;
    const reach = (index < 2 ? d : w) * 0.44;
    const flap = box(long - 4, 20, reach, kraft, 0, -6, (index % 2 ? 1 : -1) * reach / 2);
    flap.rotation.x = flaps[index] * (index % 2 ? -1 : 1);
    hinge.add(flap);
    group.add(hinge);
  }
  // A strip of tape down the seam, lifting at one end.
  const seam = box(w * 0.2, 3, d + 6, tape, w * 0.1, wall + 2, 0);
  group.add(seam);
  group.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return group;
}

/** Cartons broken down and stacked against the wall, which is where they go. */
function flattened(kraft: THREE.Material, seed: number) {
  const rnd = rng(seed);
  const group = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const slab = box(900 + rnd() * 700, 16, 1200 + rnd() * 500, kraft);
    slab.rotation.set(-Math.PI / 2 + 0.2 + rnd() * 0.06, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.1);
    slab.position.set((rnd() - 0.5) * 220, 620 + rnd() * 120, i * 44 + rnd() * 20);
    group.add(slab);
  }
  group.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return still(group);
}

/** Newspapers, squared off and tied with string for the collection. */
function bundle(news: THREE.Material, string: THREE.Material, seed: number) {
  const rnd = rng(seed);
  const group = new THREE.Group();
  const w = 760;
  const d = 540;
  const sheets = quality().tier === 'low' ? 4 : 7;
  for (let i = 0; i < sheets; i++) {
    const slab = box(w - rnd() * 60, 34, d - rnd() * 50, news, (rnd() - 0.5) * 40, 20 + i * 32, (rnd() - 0.5) * 30);
    slab.rotation.y = (rnd() - 0.5) * 0.07;
    group.add(slab);
  }
  const height = 20 + sheets * 32;
  for (const across of [false, true]) {
    const tie = new THREE.Mesh(
      new THREE.TorusGeometry(across ? d * 0.56 : w * 0.56, 7, 4, arc(18)),
      string,
    );
    tie.rotation.set(Math.PI / 2, 0, across ? Math.PI / 2 : 0);
    tie.scale.set(1, 1, height / (across ? d * 0.5 : w * 0.5));
    tie.position.y = height * 0.5;
    group.add(tie);
  }
  group.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return still(group);
}

/** A stacking crate, slatted, left behind by whoever was unloading. */
function crate(material: THREE.Material) {
  const group = new THREE.Group();
  const w = 900;
  const d = 620;
  const h = 420;
  group.add(box(w, 24, d, material, 0, 12, 0));
  for (const side of [-1, 1]) {
    group.add(box(34, h, d, material, side * (w / 2 - 17), h / 2, 0));
    group.add(box(w, 42, 34, material, 0, h - 21, side * (d / 2 - 17)));
    group.add(box(w, 34, 34, material, 0, 100, side * (d / 2 - 17)));
    for (let i = 0; i < 3; i++) {
      group.add(box(56, h - 40, 30, material, (i - 1) * w * 0.3, h / 2, side * (d / 2 - 17)));
    }
  }
  group.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return still(group);
}

/** A sheet that has been rained on and walked over: curled, never flat. */
function sheet(material: THREE.Material, w: number, d: number, curl: number) {
  const geometry = new THREE.PlaneGeometry(w, d, 5, 7);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, curl * ((x / w) ** 2 * 1.8 + (y / d) ** 2) * 240);
  }
  geometry.computeVertexNormals();
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = mesh.castShadow = true;
  return mesh;
}

/** Paper that has been screwed up: faceted, because that is what creases do. */
function crumpled(material: THREE.Material, radius: number, seed: number) {
  const rnd = rng(seed);
  const geometry = new THREE.IcosahedronGeometry(radius, 1);
  const position = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).multiplyScalar(0.88 + rnd() * 0.22);
    position.setXYZ(i, v.x, v.y * 0.84, v.z);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** A drinks bottle, turned on a profile rather than stacked out of cylinders. */
function bottle(body: THREE.Material, cap: THREE.Material) {
  const profile = [
    [0, 0], [88, 0], [96, 30], [92, 300], [96, 330], [90, 392],
    [56, 470], [34, 520], [32, 588], [44, 600], [44, 640], [0, 640],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const group = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, arc(16)), body);
  glass.castShadow = glass.receiveShadow = true;
  group.add(glass);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 60, arc(14)), cap);
  lid.position.y = 640;
  lid.castShadow = true;
  group.add(lid);
  return group;
}

/** A can somebody stood on. */
function can(material: THREE.Material) {
  const geometry = new THREE.CylinderGeometry(100, 100, 340, arc(16), 6);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const pinch = 1 - 0.55 * Math.exp(-((y / 70) ** 2));
    position.setXYZ(i, position.getX(i) * pinch, y * 0.62, position.getZ(i) * pinch);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * The whole pile, in the street's own frame: y is the pavement, the wall is
 * behind at -1300, and the board is about to be found leaning at the middle.
 *
 * Composed rather than scattered. The two clusters are heavier at the outside
 * and drop away toward the centre so the board has a gap to stand in, the tall
 * pieces go at the back against the wall, and the litter comes forward into
 * the foreground where it reads against the pavement instead of against more
 * rubbish.
 */
export function buildRubbish(): THREE.Group {
  const group = new THREE.Group();
  const ground = -20;

  const liner = (color: number, roughness: number) => new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    clearcoat: 0.22,
    clearcoatRoughness: 0.74,
    ...crinkle(),
    normalScale: new THREE.Vector2(0.5, 0.5),
  });
  const black = liner(0x1d1f20, 0.78);
  const olive = liner(0x2b3230, 0.72);
  const pale = liner(0x6f7266, 0.86);
  const kraft = new THREE.MeshStandardMaterial({ color: 0x9d7a51, roughness: 0.97, ...paper() });
  const tape = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.62 });
  const news = new THREE.MeshStandardMaterial({ color: 0xada894, roughness: 0.98, ...paper() });
  const string = new THREE.MeshStandardMaterial({ color: 0x8a8272, roughness: 1 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x8c4436, roughness: 0.62 });
  /* Faked rather than refracted. One transmissive material anywhere in a
     scene costs three.js a second pass over the whole of it, which is a great
     deal to pay for a bottle the size of a thumbnail: a glossy, part-see
     through plastic reads the same at this distance for nothing. */
  const clear = new THREE.MeshPhysicalMaterial({
    color: 0xc4cec6, roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.12,
    transparent: true, opacity: 0.62, depthWrite: false,
  });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xb6b2a6, roughness: 0.42, metalness: 0.7 });

  /* -- the back row: tall things, against the wall --------------------- */
  const wall = flattened(kraft, 77); wall.position.set(-3250, ground, -1120); wall.rotation.y = 0.12;
  group.add(wall);
  const tray = crate(plastic); tray.position.set(-4560, ground, -420); tray.rotation.y = -0.42;
  group.add(tray);
  const stack = crate(plastic); stack.position.set(-4520, ground + 428, -380); stack.rotation.y = -0.36;
  group.add(stack);

  /* -- the bags, heavier at the outside and falling away to the middle -- */
  const bags: Array<[THREE.Material, number, number, number, number, number, number]> = [
    // material, radius, x, z, tilt, roll, squash
    [black, 620, -2420, -560, 0.05, -0.08, 1.3],
    [olive, 680, -3260, -180, -0.04, 0.06, 1.16],
    [black, 520, -4020, -720, 0.08, 0.1, 1.42],
    [pale, 430, -2880, 340, 0.12, -0.14, 1.1],
    [black, 660, 2520, -520, -0.06, 0.07, 1.24],
    [olive, 720, 3380, -140, 0.04, -0.05, 1.12],
    [black, 560, 4260, -660, -0.09, 0.08, 1.34],
    [pale, 480, 2760, 420, 0.1, 0.12, 1.06],
    [black, 600, 4720, 180, 0.06, -0.1, 1.2],
  ];
  for (const [material, radius, x, z, tilt, roll, squash] of bags) {
    group.add(sack(x * 7 + z, material, radius, { x, z, y: ground, tilt, roll, squash }));
  }

  /* -- the middle ground: what came out of the bags --------------------- */
  const open = carton(1020, 660, 780, kraft, tape, [0.78, 0.44, 1.02, 0.6], 12);
  open.position.set(-1980, ground, 560); open.rotation.set(0, 0.55, -0.03);
  group.add(open);
  const tipped = carton(880, 560, 700, kraft, tape, [0.24, 0.7, 0.46, 0.66], 44);
  tipped.position.set(3720, ground + 340, 740); tipped.rotation.set(0, -0.8, 1.42);
  group.add(tipped);
  group.add(bundle(news, string, 9).translateX(2020).translateY(ground).translateZ(520));
  const spare = carton(760, 420, 620, kraft, tape, [0.5, 0.3, 0.6, 0.38], 71);
  spare.position.set(-3760, ground + 620, 300); spare.rotation.set(0.24, 0.3, -0.28);
  group.add(spare);

  /* -- the foreground: litter, which is what says nobody is coming ------ */
  const lying = bottle(clear, plastic);
  lying.position.set(1560, ground + 96, 1680); lying.rotation.set(Math.PI / 2, 0.4, 0.5);
  group.add(lying);
  const flat = can(alloy);
  flat.position.set(-1420, ground + 60, 1980); flat.rotation.set(Math.PI / 2, 0, -0.6);
  group.add(flat);
  const pages: Array<[number, number, number, number, number]> = [
    // x, z, turn, curl, width
    [-2560, 2060, 0.6, 1, 640], [880, 2420, -1.1, 0.5, 600], [2840, 1760, 0.25, 0.8, 680],
    [-900, 1180, 1.4, 0.3, 560], [3420, 1240, -0.4, 0.6, 620],
  ];
  for (const [x, z, turn, curl, width] of pages) {
    const page = sheet(news, width, width * 1.4, curl);
    page.position.set(x, ground + 14, z); page.rotation.y = turn;
    group.add(still(page));
  }
  // Faceted, because a sheet of paper creases along lines rather than curving.
  const screwed = new THREE.MeshStandardMaterial({ color: 0xb4af9c, roughness: 0.98, flatShading: true });
  for (const [x, z, radius, seed] of [[-2180, 900, 130, 5], [2280, 1080, 110, 13], [-3900, 640, 150, 21], [4200, 900, 120, 34]]) {
    const ball = crumpled(screwed, radius, seed);
    ball.position.set(x, ground + radius * 0.8, z);
    group.add(still(ball));
  }

  /* -- and the mark it has all left on the pavement --------------------- */
  const stain = new THREE.Mesh(
    new THREE.PlaneGeometry(11000, 4200, seg(11000), seg(4200)),
    new THREE.MeshBasicMaterial({
      color: 0x24261f, alphaMap: grime(), transparent: true, opacity: 0.32, depthWrite: false,
    }),
  );
  stain.rotation.x = -Math.PI / 2;
  stain.position.set(200, ground + 3, 300);
  stain.renderOrder = -1;
  group.add(still(stain));

  // None of it is going anywhere: freeze the lot rather than re-deriving a
  // hundred matrices for a pile of rubbish sixty times a second.
  group.traverse(still);
  return group;
}
