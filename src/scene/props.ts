import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COUNTER } from './layout';
import { foliage } from './parts';
import { bakeLight, mergeStatic } from './bake';
import { quality, texSize } from './quality';
import type { PropPlacement } from '../lib/types';
import { anodised, keyboard, lenses, oak, pearl, screen, softTouch, thinkDeck, thinkScreen, tinkerMark, weave } from './textures';
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
function panel(w: number, h: number, r: number, m: THREE.Material, mirror = false) {
  const g = new THREE.ShapeGeometry(rounded(w, h, r), SEGMENTS);
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
function nero() {
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

/**
 * The Levona Tinkerbel: the other kind of laptop entirely.
 *
 * Deeper, squarer and thicker than the Nero, with a twelve-unit radius where
 * the other has twenty-six — which is four millimetres against eight, and is
 * most of why one reads as milled and the other as moulded. It is a box that
 * has been getting on with it since before anybody thought a laptop should be
 * thin, and every proportion here is arguing that.
 *
 * The three things that actually name it are all small: a red nub in the
 * middle of the keys, three buttons underneath them, and a chin deep enough to
 * write on. The first two come in on the deck texture, the third is simply
 * bezel — and none of them cost a triangle, which is the only reason a second
 * machine is affordable at all.
 */
function tinkerbel() {
  const g = new THREE.Group();
  const W = 960;
  const D = 700;
  const LID = 700;
  const RAIL = 10;
  const top = 40 + RAIL;
  /** Four millimetres. A business laptop is a box and is meant to look it. */
  const R = 12;

  /* Soft-touch, not metal: the colour is nearly all of what you see, because
     there is almost no reflection left to tint. Which is also why the same six
     colours would look wrong here — this finish wants ink, not anodising. */
  const shell = new THREE.MeshStandardMaterial({
    roughness: 0.82, metalness: 0.06, envMapIntensity: 0.5, ...softTouch(),
  });
  const inner = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.78 });

  coat = (f) => {
    shell.color.setHex(f.body);
  };
  coat(finish());
  onPaint(coat);

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

  const keys = new THREE.Mesh(new THREE.PlaneGeometry(900, 390), new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, ...thinkDeck(),
  }));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(0, 41, -D / 2 + 50 + 195);
  part(g, keys);

  // matte glass, set down in its cut-out the way the other one's is
  const pad = slab(336, 176, 7, 9, new THREE.MeshStandardMaterial({
    color: 0x1c1c1e, roughness: 0.42, metalness: 0.1, envMapIntensity: 0.6,
  }));
  pad.position.set(0, 40, 210);
  part(g, pad);

  /* The name, on a card rather than in the case. It is a cut-out, so the trace
     leaves it alone — shading a rectangle with a word painted on it would
     shade the corners that are not there. */
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(190, 47), new THREE.MeshStandardMaterial({
    /* A cut-out, not a transparent card: alpha-tested it stays in the opaque
       pass, takes the trace's vertex colours like everything else on the case,
       and folds into the merge at the end of the bake instead of hanging off
       the prop as its own draw call for the rest of the session. */
    map: tinkerMark(), alphaTest: 0.4, roughness: 0.8,
  }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(-W / 2 + 150, top + 0.6, D / 2 - 44);
  part(g, mark);

  const lid = new THREE.Group();
  const shut = new THREE.ExtrudeGeometry(rounded(W, LID, R), {
    depth: 22, bevelEnabled: false, curveSegments: SEGMENTS,
  });
  shut.translate(0, 0, -11);
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
const PHONE = { w: 221, d: 451, thick: 22, r: 31 };

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

/**
 * The fujiPhone Max, face down on the counter.
 *
 * Built lying flat with its screen up, and then turned over by whoever places
 * it — which is the only orientation worth modelling from, because it is the
 * one every other pose is a rotation of. Face down on the wood, or up on the
 * charger: the same object, twice.
 *
 * Titanium white, and it is the one prop here I chose the colour of. A phone
 * is the most photographed object of the last twenty years and the colour it
 * is photographed in is always this one — a pale coating that reads warm
 * against oak and cold against concrete, which happens to be exactly the two
 * rooms it has to live in.
 */
function phone() {
  const g = new THREE.Group();
  const half = PHONE.thick / 2;

  const frame = new THREE.MeshStandardMaterial({
    color: 0xd7d4cd, roughness: 0.34, metalness: 0.62, envMapIntensity: 1.2, ...anodised(),
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.1, metalness: 0.02, envMapIntensity: 0.8, ...pearl(),
  });

  const body = slab(PHONE.w, PHONE.d, PHONE.thick, PHONE.r, frame);
  body.position.y = -half;
  part(g, body);

  // the back, which is the side you are meant to be looking at
  const back = panel(PHONE.w - 5, PHONE.d - 5, PHONE.r - 3, glass, true);
  back.rotation.x = Math.PI / 2;
  back.position.y = -half - 0.7;
  part(g, back);

  /* The plateau. Big enough that it is the first thing you see and the reason
     the thing will not lie flat on a table — which is, at this point, simply
     what a camera on a phone is. */
  const island = slab(PHONE.w * 0.62, PHONE.w * 0.62, 8, 30, frame);
  island.position.set(-PHONE.w * 0.11, -half - 8, -PHONE.d * 0.27);
  part(g, island);

  const plate = panel(PHONE.w * 0.62 - 9, PHONE.w * 0.62 - 9, 26, new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.36, metalness: 0.35, envMapIntensity: 1, ...lenses(),
  }), true);
  plate.rotation.x = Math.PI / 2;
  plate.position.set(-PHONE.w * 0.11, -half - 8.7, -PHONE.d * 0.27);
  part(g, plate);

  lit = handsetScreen();
  const face = panel(PHONE.w - 17, PHONE.d - 17, PHONE.r - 9, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.08,
    envMapIntensity: 0.3,
    emissive: 0xffffff,
    emissiveIntensity: 0.55,
    map: lit.texture,
    emissiveMap: lit.texture,
  }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = half + 0.7;
  part(g, face);

  // volume down the one side, sleep down the other
  for (const [x, z, len] of [[-1, -58, 74], [-1, 34, 74], [1, -22, 96]] as [number, number, number][]) {
    part(g, bx(7, 11, len, frame, (x * PHONE.w) / 2, -half + 3, z));
  }

  return g;
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
    return;
  }
  handset.position.y = COUNTER.top + PHONE.thick / 2;
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
  const handset = placed.find((p) => p.def.id === 'phone');
  const stand = placed.find((p) => p.def.id === 'dock');
  if (!handset) return;

  if (moving === 'phone' && stand) {
    const dx = handset.group.position.x - stand.group.position.x;
    const dz = handset.group.position.z - stand.group.position.z;
    docked = Math.hypot(dx, dz) < DOCK.magnet;
  }
  pose(handset.group, stand?.group);
}

/**
 * The one thing in either room that moves while nobody is touching it.
 *
 * Everything else here is drawn once and then costs nothing until the camera
 * moves, which is the property the whole scene is built on — so a screen that
 * animates is a deliberate hole in it, and it is kept as small as the hole can
 * be. Ten frames a second rather than sixty, nothing at all unless the phone
 * is actually on the charger, and the moment it comes off the room goes quiet
 * again.
 */
export function animateProps(seconds: number): boolean {
  if (!lit) return false;
  if (!docked) {
    // one last frame, to put it to sleep
    if (lastDrawn < 0) return false;
    lastDrawn = -1;
    lit.draw(-1);
    return true;
  }
  if (lastDrawn >= 0 && seconds - lastDrawn < 0.1) return false;
  lastDrawn = seconds;
  lit.draw(seconds);
  return true;
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
