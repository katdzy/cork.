import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COUNTER } from './layout';
import { arc, foliage } from './parts';
import { bakeLight, mergeStatic } from './bake';
import { isHandheld, quality, texSize } from './quality';
import type { PropPlacement } from '../lib/types';
import { anodised, keyboard, NERO_KEYS, THINK_KEYS, lensGlass, lenses, oak, pearl, screen, softTouch, thinkDeck, thinkScreen, tinkerMark, weave } from './textures';
import { onPhonePaint, phoneFinish } from './phoneFinishes';
import { finish, model, onPaint, onSwap, type Finish } from './models';

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

/**
 * A turned thing: a mug, a pot, a vase, the foot of a lamp.
 *
 * Thinned on the machines that would rather not, the same way the room's own
 * cylinders are. The rooms have gone through `arc` since they were written
 * and the props never did, which left the nine things on the counter built to
 * full detail on a phone that had just been handed a quarter-size wall — and
 * they are not a rounding error next to the room, because each one is also
 * traced and welded. Every segment taken off here comes off three times: the
 * triangles, the vertices the bake has to find light for, and the vertices
 * `knit` has to weld together afterwards.
 */
const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 20) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, arc(seg)), m);

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
function panel(w: number, h: number, r: number, m: THREE.Material, mirror = false, segments = SEGMENTS) {
  const g = new THREE.ShapeGeometry(rounded(w, h, r), segments);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const at = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    /* A face that ends up pointing away from the viewer is read from behind,
       and a word on it comes out backwards. Mirroring the coordinates is the
       fix that costs nothing at draw time — the alternative is a second
       rotation and an argument with Euler order. */
    uv.setXY(i, (mirror ? -at.getX(i) : at.getX(i)) / w + 0.5, at.getY(i) / h + 0.5);
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
let phoneCoat: ((f: Finish) => void) | null = null;

/** Rounded aluminum notebook with sculpted, color-matched keys and a glass trackpad. */
function nero() {
  const g = new THREE.Group();
  const W = 960;
  const D = 676;
  const LID = 628;
  /** How far the aluminium stands above the well the keys sit in. */
  const RAIL = 8;
  const top = 36 + RAIL;
  /** Eight millimetres, which is about what the corners of one of these run to. */
  const R = 38;

  /* Anodising is a tint in the oxide rather than a coat of paint over it, so
     the colour has to survive being mostly reflection — which is why the
     metalness sits where it does. Take it much higher and the colour goes out
     of it; take it much lower and it stops being metal at all. The tooth under
     it is the blasting, which is the other half of why the real thing never
     looks like plastic. */
  const shell = new THREE.MeshStandardMaterial({
    roughness: 0.43, metalness: 0.72, envMapIntensity: 1.1, ...anodised(true),
  });
  /* Glass over the same metal, so it is the body colour a shade down rather
     than a colour of its own — which is what a trackpad actually is. */
  const pane = new THREE.MeshStandardMaterial({
    roughness: 0.34, metalness: 0.18, envMapIntensity: 0.8,
  });
  const keySides = new THREE.MeshStandardMaterial({ roughness: 0.63 });
  const keyTops = new THREE.MeshStandardMaterial({ roughness: 0.58, ...keyboard() });
  coat = (f) => {
    shell.color.setHex(f.body);
    pane.color.setHex(f.body).multiplyScalar(0.96);
    keySides.color.setHex(f.body).lerp(new THREE.Color(0xffffff), 0.72);
    keyTops.color.copy(keySides.color);
  };
  coat(finish());

  const inner = new THREE.MeshStandardMaterial({ color: 0x3a3c36, roughness: 0.66 });

  const machined = (w: number, d: number, h: number, r: number, material: THREE.Material) => {
    const bevel = Math.min(2, h / 4);
    const geometry = new THREE.ExtrudeGeometry(rounded(w - bevel * 2, d - bevel * 2, r - bevel), {
      depth: h - bevel * 2, bevelEnabled: true, bevelSize: bevel,
      bevelThickness: bevel, bevelSegments: h < 5 ? 1 : 2, curveSegments: h < 5 ? 3 : 6,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, h - bevel, 0);
    const mesh = new THREE.Mesh(knit(geometry), material);
    geometry.dispose();
    return mesh;
  };

  /* A plate under the case, inset all round. The gap it leaves is where the
     contact shadow goes, and a machine with one reads as standing on the
     counter rather than as printed on it. */
  part(g, slab(W - 52, D - 52, 6, R - 12, shell));
  const base = machined(W, D, 30, R, shell);
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

  const well = slab(878, 358, 1, 15, inner);
  well.position.set(0, 36, -139);
  part(g, well);
  // Geometry carries the depth; a shared atlas carries only the legends and cap sheen.
  const sx = 880 / 1024;
  const sz = 330 / 384;
  for (const key of NERO_KEYS) {
    const w = key.w * sx;
    const d = key.h * sz;
    const x = (key.x + key.w / 2 - 512) * sx;
    const z = -288 + (key.y + key.h / 2) * sz;
    const cap = machined(w, d, 4.5, 4.5, keySides);
    cap.position.set(x, 37, z);
    part(g, cap);
    const topFace = panel(w - 2, d - 2, 3.5, keyTops);
    const uv = topFace.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (key.x + 1 / sx + uv.getX(i) * (key.w - 2 / sx)) / 1024,
        1 - (key.y + 1 / sz + (1 - uv.getY(i)) * (key.h - 2 / sz)) / 384);
    }
    topFace.rotation.x = -Math.PI / 2;
    topFace.position.set(x, 41.6, z);
    part(g, topFace);
  }

  /* Set down in its cut-out rather than laid on top of it. A trackpad is very
     nearly flush with the case, so what you actually find it by is the
     hairline of shadow round the edge — which needs an edge to fall down. */
  const pad = machined(424, 244, 7, 18, pane);
  pad.position.set(0, 36, D / 2 - 148);
  part(g, pad);

  // Finger scoop, bottom seam, and rubber feet give the thin case a readable edge.
  const scoop = panel(126, 8, 4, inner);
  scoop.position.set(0, 34, D / 2 + 0.15);
  part(g, scoop);
  for (const x of [-W / 2 + 55, W / 2 - 55]) {
    for (const z of [-D / 2 + 55, D / 2 - 55]) {
      const foot = cyl(20, 22, 4, inner, 16);
      foot.position.set(x, 2, z);
      part(g, foot);
    }
  }
  // Side-mounted USB-C ports and an audio jack sit inside dark, chamfered openings.
  for (const z of [-225, -163]) {
    const port = panel(27, 10, 5, inner);
    port.rotation.y = -Math.PI / 2;
    port.position.set(-W / 2 - 0.1, 22, z);
    part(g, port);
    part(g, bx(0.6, 2, 18, pane, -W / 2 - 0.3, 22, z));
  }
  const jack = new THREE.Mesh(new THREE.CircleGeometry(5, 16), inner);
  jack.rotation.y = -Math.PI / 2;
  jack.position.set(-W / 2 - 0.15, 22, -105);
  part(g, jack);
  for (const x of [-340, 340]) {
    const hinge = cyl(10, 10, 125, shell, 20);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(x, 44, -D / 2 + 20);
    part(g, hinge);
  }

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
  const shut = new THREE.ExtrudeGeometry(rounded(W - 4, LID - 4, R - 4), {
    depth: 14, bevelEnabled: true, bevelSize: 2, bevelThickness: 2, bevelSegments: 2, curveSegments: 6,
  });
  shut.translate(0, 0, -7);
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
  }), false, 6);
  face.position.set(0, LID / 2, 10);
  part(lid, face);
  lid.position.set(0, top, -D / 2 + 9);
  lid.rotation.x = -0.26;
  g.add(lid);
  return g;
}

/** Squared soft-touch workstation with dished keys and physical pointing controls. */
function tinkerbel() {
  const g = new THREE.Group();
  const W = 960;
  const D = 700;
  const LID = 654;
  const RAIL = 10;
  const top = 40 + RAIL;
  /** Four millimetres. A business laptop is a box and is meant to look it. */
  const R = 12;

  /* Soft-touch, not metal: the colour is nearly all of what you see, because
     there is almost no reflection left to tint. Which is also why the same six
     colours would look wrong here — this finish wants ink, not anodising. */
  const shell = new THREE.MeshStandardMaterial({
    roughness: 0.76, metalness: 0.02, envMapIntensity: 0.65, ...softTouch(),
  });
  const inner = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.78 });

  const badgeMaterial = new THREE.MeshStandardMaterial({
    map: tinkerMark(), alphaTest: 0.4, roughness: 0.68,
  });
  coat = (f) => {
    shell.color.setHex(f.body);
    badgeMaterial.map = tinkerMark(f.id === 'white');
  };
  coat(finish());


  part(g, slab(W - 56, D - 56, 6, R - 5, shell));
  const base = slab(W, D, 34, R, shell);
  base.position.y = 6;
  part(g, base);

  /* One plate with the well and the trackpad taken out of it. The well runs
     deeper than the other machine's because it has the buttons in it. */
  const deck = slab(W, D, RAIL, R, shell, [
    { w: 900, d: 390, r: 10, z: -D / 2 + 50 + 195 },
    { w: 340, d: 180, r: 10, z: 210 },
  ]);
  deck.position.y = 40;
  part(g, deck);

  part(g, bx(900, 4, 28, inner, 0, 42, -D / 2 + 36));

  const well = slab(898, 388, 1, 9, inner);
  well.position.set(0, 40, -105);
  part(g, well);
  const capSide = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.7 });
  const capTop = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, ...thinkDeck() });
  const sx = 900 / 1024;
  const sz = 390 / 444;
  for (const key of THINK_KEYS) {
    const w = key.w * sx;
    const d = key.h * sz;
    const x = (key.x + key.w / 2 - 512) * sx;
    const z = -300 + (key.y + key.h / 2) * sz;
    const geometry = new THREE.ExtrudeGeometry(rounded(w - 2, d - 2, 4), {
      depth: 4.5, bevelEnabled: true, bevelSize: 1, bevelThickness: 1,
      bevelSegments: 1, curveSegments: 3,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 5.5, 0);
    const cap = new THREE.Mesh(knit(geometry), capSide);
    geometry.dispose();
    cap.position.set(x, 41, z);
    part(g, cap);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 4, d - 4, 4, 4), capTop);
    // A shallow concave top catches light at the edges of each key.
    const positions = face.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const edge = Math.max(Math.abs(positions.getX(i)) / (w / 2), Math.abs(positions.getY(i)) / (d / 2));
      positions.setZ(i, 0.65 * edge * edge);
    }
    face.geometry.computeVertexNormals();
    const uv = face.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (key.x + 2 / sx + uv.getX(i) * (key.w - 4 / sx)) / 1024,
        1 - (key.y + 2 / sz + (1 - uv.getY(i)) * (key.h - 4 / sz)) / 444);
    }
    face.rotation.x = -Math.PI / 2;
    face.position.set(x, 47.6, z);
    part(g, face);
  }

  const red = new THREE.MeshStandardMaterial({ color: 0xd62f32, roughness: 0.88 });
  const keyG = THINK_KEYS.find((key) => key.label === 'G')!;
  const nubX = (keyG.x + keyG.w + 3.5 - 512) * sx;
  const nubZ = -300 + (keyG.y + keyG.h + 3) * sz;
  const nub = cyl(8.5, 10, 7, red, 24);
  nub.position.set(nubX, 49, nubZ);
  part(g, nub);
  // Raised rubber dots make the pointing stick visibly tactile at close range.
  for (let x = -5; x <= 5; x += 2.5) {
    for (let z = -5; z <= 5; z += 2.5) {
      if (Math.hypot(x, z) > 6) continue;
      const dot = cyl(0.65, 0.8, 0.8, red, 6);
      dot.position.set(nubX + x, 52.9, nubZ + z);
      part(g, dot);
    }
  }
  for (const [x, w] of [[-126, 142], [0, 102], [126, 142]]) {
    const button = slab(w, 52, 6, 6, capSide);
    button.position.set(x, 42, 46);
    part(g, button);
    const stripe = bx(w - 20, 0.6, 2, red, x, 48.3, 25);
    part(g, stripe);
    if (x === 0) {
      for (const z of [36, 43, 50]) part(g, bx(30, 0.7, 1.4, inner, x, 48.4, z));
    }
  }

  // matte glass, set down in its cut-out the way the other one's is
  const pad = slab(336, 176, 7, 9, new THREE.MeshStandardMaterial({
    color: 0x1c1c1e, roughness: 0.42, metalness: 0.1, envMapIntensity: 0.6,
  }));
  pad.position.set(0, 40, 210);
  part(g, pad);

  const mark = new THREE.Mesh(new THREE.PlaneGeometry(200, 50), badgeMaterial);
  mark.rotation.x = -Math.PI / 2;
  mark.rotateZ(0.15);
  mark.position.set(W / 2 - 144, top + 0.7, D / 2 - 61);
  part(g, mark);

  const metal = new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 0.35, metalness: 0.8 });
  for (const x of [-350, 350]) {
    const hinge = cyl(12, 12, 100, metal, 20);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(x, 49, -D / 2 + 19);
    part(g, hinge);
  }
  // Fingerprint reader and power key have distinct inset borders.
  const reader = slab(37, 43, 1, 4, inner);
  reader.position.set(260, top + 0.2, 164);
  part(g, reader);
  const sensor = slab(29, 35, 1, 3, capSide);
  sensor.position.set(260, top + 1.3, 164);
  part(g, sensor);
  const power = cyl(12, 13, 2, inner, 20);
  power.position.set(415, top + 1, -322);
  part(g, power);
  const led = new THREE.MeshStandardMaterial({ color: 0xbad2b1, emissive: 0x6c985f, emissiveIntensity: 0.3 });
  part(g, bx(8, 0.6, 1.5, led, 415, top + 2.2, -322));

  // Vent slots and port faces stay shallow so they read as openings in the case.
  for (let z = -240; z <= -70; z += 12) {
    const slot = panel(5, 16, 2, inner);
    slot.rotation.y = Math.PI / 2;
    slot.position.set(W / 2 + 0.15, 25, z);
    part(g, slot);
  }
  for (const [z, width, height] of [[-240, 28, 10], [-185, 28, 10], [-112, 48, 16], [-28, 44, 16]]) {
    const port = panel(width, height, 3, inner);
    port.rotation.y = -Math.PI / 2;
    port.position.set(-W / 2 - 0.15, 24, z);
    part(g, port);
    part(g, bx(0.5, 2, width - 9, metal, -W / 2 - 0.3, 24, z));
  }
  for (const x of [-400, 400]) {
    for (const z of [-285, 285]) {
      const foot = slab(65, 26, 4, 8, inner);
      foot.position.set(x, 0, z);
      part(g, foot);
    }
  }

  const lid = new THREE.Group();
  const shut = new THREE.ExtrudeGeometry(rounded(W - 3, LID - 3, R), {
    depth: 19, bevelEnabled: true, bevelSize: 1.5, bevelThickness: 1.5, bevelSegments: 2, curveSegments: 4,
  });
  shut.translate(0, 0, -9.5);
  const panelMesh = new THREE.Mesh(knit(shut), shell);
  panelMesh.position.y = LID / 2;
  part(lid, panelMesh);

  const lit = thinkScreen();
  const face = panel(W - 10, LID - 10, R - 4, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    envMapIntensity: 0.35,
    /* A brighter panel than the Nero's, because what is on it is a pale
       desktop rather than a dark one, and a screen carrying a white window is
       the brightest thing in any room it is open in. */
    emissive: 0xffffff,
    emissiveIntensity: 0.34,
    emissiveMap: lit.map,
    ...lit,
  }));
  face.position.set(0, LID / 2, 12);
  lid.add(face);
  lid.position.set(0, top, -D / 2 + 11);
  lid.rotation.x = -0.3;
  g.add(lid);
  return g;
}

/** Whichever of the two is open at the moment. */
function laptop() {
  return model().id === 'tinkerbel' ? tinkerbel() : nero();
}

/* ------------------------------------------------------------------ phone */

/** Seventy-two millimetres across, and every other number follows from it. */
const PHONE = { w: 221, d: 451, thick: 22, r: 48 };

/**
 * Where the handset ends up when the magnet takes it, relative to the dock.
 *
 * The lean is the whole design of one of these: upright enough to read from
 * across a counter, tipped back enough that it is looking at your face rather
 * than at the ceiling. Fifteen degrees is where a phone on a stand has always
 * sat, and it is not a coincidence that it is also roughly where a photograph
 * leans in a frame.
 */
const DOCK = { lift: 236, out: 26, lean: 0.26, magnet: 430 };

/** A canvas the phone is charging on, and the hand that redraws it. */
interface Screen {
  texture: THREE.CanvasTexture;
  draw(seconds: number): void;
}

function handsetScreen(): Screen {
  const W = texSize(384, 1);
  const H = Math.round(W * (812 / 384));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const s = W / 384;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  const draw = (seconds: number) => {
    ctx.save();
    ctx.scale(s, s);
    const w = 384;
    const h = 812;

    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, w, h);

    /* Off the charger it is asleep, which is a black rectangle and no more.
       Worth drawing rather than leaving the last frame up: a phone lying face
       down on a counter with a lit screen under it is a phone somebody is
       about to be annoyed with. */
    if (seconds < 0) {
      ctx.restore();
      texture.needsUpdate = true;
      return;
    }

    /* The whole screen breathes with the fill, because a phone charging in the
       corner of your eye is a glow that comes and goes rather than a number
       you read. The number is there for when you do look. */
    const cycle = (seconds % 6) / 6;
    const pct = Math.min(100, Math.round(18 + cycle * 82));
    const glow = ctx.createRadialGradient(w / 2, h * 0.44, 10, w / 2, h * 0.44, w * 0.9);
    glow.addColorStop(0, `rgba(126,214,146,${0.16 + 0.1 * Math.sin(seconds * 1.6)})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.44;
    const r = w * 0.3;

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#6fd489';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pct / 100));
    ctx.stroke();

    // the bolt, which is the one glyph that means this everywhere
    ctx.fillStyle = '#eafbee';
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - 44);
    ctx.lineTo(cx - 18, cy + 6);
    ctx.lineTo(cx - 1, cy + 6);
    ctx.lineTo(cx - 11, cy + 46);
    ctx.lineTo(cx + 19, cy - 6);
    ctx.lineTo(cx + 2, cy - 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f2f5f3';
    ctx.textAlign = 'center';
    ctx.font = '700 46px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${pct}%`, cx, cy + r + 74);

    ctx.fillStyle = 'rgba(226,232,229,0.4)';
    ctx.font = '600 22px ui-sans-serif, system-ui, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('CHARGING', cx, cy + r + 112);
    ctx.letterSpacing = '0px';

    // the time, up where a phone always puts it
    ctx.fillStyle = '#e8ece9';
    ctx.font = '300 74px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('9:41', cx, h * 0.17);

    ctx.restore();
    texture.needsUpdate = true;
  };

  draw(-1);
  return { texture, draw };
}

let lit: Screen | null = null;

/** Screen faces +Y; the pearl back and camera assembly face -Y. */
function phone() {
  const g = new THREE.Group();
  const half = PHONE.thick / 2;
  const frame = new THREE.MeshStandardMaterial({
    color: 0xa7a095, roughness: 0.34, metalness: 0.82, envMapIntensity: 1.3,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0xc4bdb1, roughness: 0.23, metalness: 0.88, envMapIntensity: 1.4,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171a1e, roughness: 0.28, metalness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.25, metalness: 0.32, clearcoat: 0.85,
    clearcoatRoughness: 0.12, envMapIntensity: 1.15, ...pearl(),
  });

  // Bevels stay inside the requested bounds so the front still rests on the desk.
  const shell = (w: number, d: number, h: number, r: number, bevel: number, material: THREE.Material) => {
    const geometry = new THREE.ExtrudeGeometry(rounded(w - bevel * 2, d - bevel * 2, r - bevel), {
      depth: h - bevel * 2, bevelEnabled: true, bevelSize: bevel,
      bevelThickness: bevel, bevelSegments: 3, curveSegments: 10,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, h - bevel, 0);
    const mesh = new THREE.Mesh(knit(geometry), material);
    geometry.dispose();
    return mesh;
  };
  const body = shell(PHONE.w, PHONE.d, PHONE.thick, PHONE.r, 3, frame);
  body.position.y = -half;
  part(g, body);

  const back = panel(PHONE.w - 7, PHONE.d - 7, PHONE.r - 4, glass, true, 10);
  back.rotation.x = Math.PI / 2;
  back.position.y = -half - 0.4;
  part(g, back);

  // Rear-view left is +X in the screen-facing model. Keep the island's
  // layout in rear-view coordinates, then convert it once at placement.
  const camera = new THREE.Group();
  camera.position.set(44, -half, -151);
  camera.scale.set(0.7, 1, 0.7);
  g.add(camera);
  const island = shell(151, 151, 12, 34, 3, trim);
  island.position.set(0, -12, 0);
  part(camera, island);
  const gasket = panel(142, 142, 30, dark, true, 10);
  gasket.rotation.x = Math.PI / 2;
  gasket.position.y = -12.15;
  part(camera, gasket);
  const plate = panel(135, 135, 27, new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.38, metalness: 0.55, envMapIntensity: 1, ...lenses(),
  }), true, 10);
  plate.rotation.x = Math.PI / 2;
  plate.position.set(0, -12.2, 0);
  part(camera, plate);

  // Two overlapping capsule supports reproduce the diagonal, folded island.
  const supportMaterial = new THREE.MeshStandardMaterial({
    color: 0x8e877e, roughness: 0.32, metalness: 0.78, envMapIntensity: 1.1,
  });
  for (const [ax, az, bx, bz, height] of [[27, 33, -30, 0, 1.5], [27, -33, -30, 0, 2]]) {
    const dx = bx - ax;
    const dz = bz - az;
    const support = shell(58, Math.hypot(dx, dz) + 58, height, 29, 0.5, supportMaterial);
    support.rotation.y = Math.atan2(dx, dz);
    support.position.set((ax + bx) / 2, -12.3 - height, (az + bz) / 2);
    part(camera, support);
  }
  phoneCoat = (f) => {
    const titanium = f.id === 'titanium';
    frame.color.setHex(f.body);
    trim.color.setHex(titanium ? 0xc4bdb1 : f.body).lerp(new THREE.Color(0xffffff), titanium ? 0 : 0.16);
    supportMaterial.color.setHex(titanium ? 0x8e877e : f.body);
    glass.color.setHex(titanium ? 0xffffff : f.body);
    glass.map = pearl(!titanium).map!;
  };
  phoneCoat(phoneFinish());

  const indicator = new THREE.Mesh(new THREE.CircleGeometry(1.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x783c30, roughness: 0.4 }));
  indicator.rotation.x = Math.PI / 2;
  indicator.position.set(-27, -12.4, -49);
  part(camera, indicator);

  const optics = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.1, metalness: 0.35, envMapIntensity: 1.3, ...lensGlass(),
  });
  for (const [x, z, radius] of [[-27, -33, 27], [30, 0, 27], [-27, 33, 27]]) {
    const barrel = cyl(radius, radius, 5, dark, 40);
    barrel.position.set(-x, -14.5, z);
    part(camera, barrel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius - 1.2, 1.8, 6, arc(40)), trim);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(-x, -17, z);
    part(camera, rim);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(radius - 3, arc(40)), optics);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(-x, -17.1, z);
    part(camera, lens);
  }

  const flash = shell(18, 25, 1.8, 7, 0.6, trim);
  flash.position.set(-76, -half - 1.8, -167);
  part(g, flash);
  const diffuser = panel(12, 18, 5, new THREE.MeshStandardMaterial({
    color: 0xfff8df, roughness: 0.25,
  }));
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.set(-76, -half - 2, -167);
  part(g, diffuser);

  lit = handsetScreen();
  const face = panel(PHONE.w - 17, PHONE.d - 17, PHONE.r - 9, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.08,
    envMapIntensity: 0.3,
    emissive: 0xffffff,
    emissiveIntensity: 0.55,
    map: lit.texture,
    emissiveMap: lit.texture,
  }), false, 10);
  face.rotation.x = -Math.PI / 2;
  face.position.y = half + 0.7;
  part(g, face);

  // Rounded, inset side controls follow the rail instead of protruding as boxes.
  for (const [side, z, length] of [[-1, -62, 53], [-1, 7, 36], [1, -34, 63]]) {
    const button = shell(8, length, 3, 3.5, 0.8, trim);
    button.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    button.position.set(side * (PHONE.w / 2 - 0.5), 0, z);
    part(g, button);
  }

  // Rotate the model itself so saved counter placements also get the new heading.
  const handset = new THREE.Group();
  g.rotation.y = Math.PI;
  handset.add(g);
  return handset;
}

/**
 * The stand it goes on: a weight, a neck and a magnet.
 *
 * All three of those are the same idea — a phone stood up wants to fall over,
 * and every one of these ever sold is an argument about where to put the mass
 * so it does not. The base is most of the object for that reason, and the neck
 * leans back rather than standing straight because the phone's own weight has
 * to fall inside the base or the whole thing tips the first time you tap it.
 */
function dock() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0xd9d6cf, roughness: 0.36, metalness: 0.58, envMapIntensity: 1.15, ...anodised(),
  });
  const pad = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.62 });

  const foot = part(g, cyl(168, 182, 26, metal, 18));
  foot.position.y = 13;

  // the neck, leaning back under the phone it is about to hold up
  const neck = part(g, bx(74, 226, 30, metal, 0, 0, 0));
  neck.position.set(0, 128, -34);
  neck.rotation.x = 0.26;

  const puck = part(g, cyl(104, 104, 16, pad, 18));
  puck.position.set(0, DOCK.lift - 8, DOCK.out - 14);
  puck.rotation.x = Math.PI / 2 - DOCK.lean;

  const ring = part(g, new THREE.Mesh(new THREE.TorusGeometry(96, 4.5, 4, 18), metal));
  ring.position.copy(puck.position);
  ring.rotation.x = puck.rotation.x;

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
  { id: 'dock', label: 'Charging stand', x: 1560, z: 1380, rotation: 0.03, radius: 230, build: dock },
  { id: 'phone', label: 'fujiPhone Max', x: 2020, z: 1420, rotation: -0.24, radius: 180, build: phone },
  { id: 'crate', label: 'Crate', x: 2560, z: 1180, rotation: -0.16, radius: 340, build: crate },
  { id: 'herbs', label: 'Herbs', x: 3420, z: 820, rotation: 0, radius: 340, build: herbs },
];

export interface PlacedProp {
  def: PropDef;
  group: THREE.Group;
}

/* -------------------------------------------------------------- the magnet */

/** Whether the handset is on the charger. Its whole pose is a function of it. */
let docked = false;
let lastDrawn = -1;

export const isDocked = () => docked;

/**
 * Where the handset is, as one sphere, kept up to date by `reseat`.
 *
 * Measured there rather than here because there is where it moves: the phone
 * is put down, picked up, or snapped onto the stand, and nothing else in the
 * room can change its bounds. Reading them per frame would mean walking the
 * group and its world matrices sixty times a second to be told the same
 * number, which is the shape of thing this whole file exists to avoid.
 */
const shot = new THREE.Frustum();
const shotMatrix = new THREE.Matrix4();
const handsetBounds = new THREE.Box3();
const handsetSphere = new THREE.Sphere();
let handsetPlaced = false;

/**
 * Put the handset where it belongs: flat on the wood, or up on the stand.
 *
 * Two poses of one object, and the interesting one is the first. A phone left
 * on a counter is face down — not because anybody decided to, but because that
 * is what a hand does with a phone it has finished with, and a phone lying
 * screen-up on a kitchen worktop reads instantly as staged. So the resting
 * pose is a half turn, and the camera you spent all that money on is the part
 * that shows.
 *
 * On the stand it is the other way up and leaning back, and the screen comes
 * on — which is the entire reason anybody buys one of these stands.
 */
function pose(handset: THREE.Group, stand: THREE.Group | undefined) {
  if (docked && stand) {
    handset.position.set(
      stand.position.x,
      COUNTER.top + DOCK.lift,
      stand.position.z + DOCK.out,
    );
    handset.rotation.set(Math.PI / 2 - DOCK.lean, stand.rotation.y, 0);
    // Cancel the counter heading while docked so the display faces forward.
    handset.rotateY(Math.PI);
    return;
  }
  handset.position.y = COUNTER.top + PHONE.thick / 2 + 0.7;
  handset.rotation.set(Math.PI, handset.rotation.y, 0);
}

/**
 * Work out whether the magnet has it, and put it where that means.
 *
 * Called on every frame of a drag rather than only when the thing is let go,
 * because a magnet you cannot feel until afterwards is not a magnet. Dragging
 * the phone towards the stand should have it stand up while it is still under
 * your hand; dragging it away should drop it flat again in the same motion.
 *
 * Dragging the *stand* is the other half: something already on it is held on,
 * and goes where the stand goes.
 */
export function reseat(placed: readonly PlacedProp[], moving: string | null) {
  const phone = placed.find((p) => p.def.id === 'phone');
  const stand = placed.find((p) => p.def.id === 'dock');
  if (!phone) return;

  if (moving === 'phone' && stand) {
    const dx = phone.group.position.x - stand.group.position.x;
    const dz = phone.group.position.z - stand.group.position.z;
    docked = Math.hypot(dx, dz) < DOCK.magnet;
  }
  pose(phone.group, stand?.group);

  /* And where that leaves it, for the screen to check itself against. */
  handsetBounds.setFromObject(phone.group);
  handsetPlaced = !handsetBounds.isEmpty();
  if (handsetPlaced) handsetBounds.getBoundingSphere(handsetSphere);
}

/**
 * How often the charging screen is allowed to wake the room, in seconds.
 *
 * Because that is what it is doing. Redrawing the canvas is the small half of
 * the cost; the large half is that a redrawn canvas is a reason to draw the
 * whole room again — the sun, the shadow filter, the bloom pyramid, the
 * composite — for a battery ring two centimetres across. Ten times a second,
 * for as long as the phone is on the stand, whether or not anybody is looking
 * at the room.
 *
 * On a desktop that is a rounding error on an idle machine. On a phone it is
 * the room being drawn ten times a second while sitting still, and the part
 * this matters most to is the part that gets slower the longer it is warm:
 * heat spent on an idle room is speed taken from the next time somebody
 * actually swings the camera. So a handheld gets four frames a second, which
 * is still a ring that fills and a glow that breathes, and about a third of
 * the heat.
 */
const SCREEN_INTERVAL = isHandheld() ? 0.26 : 0.1;

/**
 * The one thing in either room that moves while nobody is touching it.
 *
 * Everything else here is drawn once and then costs nothing until the camera
 * moves, which is the property the whole scene is built on — so a screen that
 * animates is a deliberate hole in it, and it is kept as small as the hole can
 * be: a few frames a second rather than sixty, nothing at all unless the phone
 * is actually on the charger, and the moment it comes off the room goes quiet
 * again.
 *
 * And nothing at all unless it is in shot, which is the other half of the
 * hole and the one that was left open. The phone stands on a counter at one
 * end of the room; walk round to the board, or square on to the cork, and it
 * is behind you — and it was still redrawing itself and still asking for the
 * whole room to be drawn around it, at a cost per frame that has nothing to
 * do with how much of the frame it occupies. Asking the camera first is four
 * plane tests against a sphere, once per frame, and it turns the most common
 * view in the app back into a still one.
 */
export function animateProps(seconds: number, camera?: THREE.Camera): boolean {
  if (!lit) return false;
  if (!docked) {
    // one last frame, to put it to sleep
    if (lastDrawn < 0) return false;
    lastDrawn = -1;
    lit.draw(-1);
    return true;
  }
  if (lastDrawn >= 0 && seconds - lastDrawn < SCREEN_INTERVAL) return false;
  if (camera && !inShot(camera)) return false;
  lastDrawn = seconds;
  lit.draw(seconds);
  return true;
}

function inShot(camera: THREE.Camera): boolean {
  if (!handsetPlaced) return true;
  shot.setFromProjectionMatrix(
    shotMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  return shot.intersectsSphere(handsetSphere);
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
  saved: Record<string, PropPlacement>,
  settled: () => void,
): { group: THREE.Group; placed: PlacedProp[] } {
  const group = new THREE.Group();
  const placed: PlacedProp[] = [];
  // A prop is a few hundred vertices against a few hundred triangles, so its
  // share of the budget buys it a far finer trace than the same share buys a
  // wall. Nine of them still come to less than the room.
  const budget = Math.round(quality().rayBudget * 0.035);

  const light = (def: PropDef, g: THREE.Group) =>
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

  const mark = (def: PropDef, g: THREE.Group) => {
    g.userData.propId = def.id;
    g.traverse((o) => {
      o.userData.propId = def.id;
    });
  };

  for (const def of PROPS) {
    const g = def.build();
    const at = saved[def.id];
    g.position.set(at?.x ?? def.x, COUNTER.top, at?.z ?? def.z);
    g.rotation.y = at?.rotation ?? def.rotation;
    light(def, g);
    mark(def, g);
    group.add(g);
    placed.push({ def, group: g });
  }

  /* The handset is the one prop whose saved position is not the whole of where
     it is: on the charger it borrows the charger's, and which of the two it is
     doing has to survive a reload. */
  docked = saved.phone?.docked ?? false;
  reseat(placed, null);

  /* Recolouring is one uniform and no rebuild — but the room is drawn on
     demand, so putting the colour on and asking for the frame that would show
     it are two separate things, and a change made while nothing else is
     moving needs both or it waits for the next time somebody touches the
     camera. */
  onPhonePaint((f) => {
    phoneCoat?.(f);
    settled();
  });

  onPaint((f) => {
    coat?.(f);
    settled();
  });

  /*
   * The other machine, in the same place.
   *
   * A colour is a uniform; a different laptop is different triangles, and the
   * only honest way to get them is to build them. But only this one prop: the
   * room, the board and the other eight things on the counter have no opinion
   * about which laptop it is, and tearing the scene down to change one object
   * on it would throw away every bake in the room to avoid writing this.
   *
   * What carries over is where it was standing. Somebody who has pushed the
   * laptop to the end of the counter and then tries the other one has not
   * asked for it back in the middle.
   */
  onSwap(() => {
    const entry = placed.find((p) => p.def.id === 'laptop');
    if (!entry) return;
    const { x, z } = entry.group.position;
    const turned = entry.group.rotation.y;

    group.remove(entry.group);
    entry.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });

    const g = entry.def.build();
    g.position.set(x, COUNTER.top, z);
    g.rotation.y = turned;
    light(entry.def, g);
    mark(entry.def, g);
    group.add(g);
    entry.group = g;
    settled();
  });

  return { group, placed };
}
