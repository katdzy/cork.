import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { quality } from './quality';

/**
 * The pieces every room is made of.
 *
 * Two rooms share this: a warm kitchen command centre and a dark concrete
 * studio. What differs between them is materials, fittings and light — the
 * boxes, the plants and the glow are the same boxes, plants and glow.
 */

/** Freeze an object's matrix. Nothing in a room moves, so nothing should be
 *  re-derived on every frame — over a hundred meshes that adds up. */
export const still = <T extends THREE.Object3D>(o: T) => {
  o.matrixAutoUpdate = false;
  o.updateMatrix();
  return o;
};

/**
 * How finely to divide a surface of this size.
 *
 * Baked light is stored per vertex, so a wall with four corners can only be
 * lit at its four corners: the dark band where it meets the floor spreads
 * itself evenly across three metres of plaster instead of sitting in the
 * bottom forty centimetres, where it belongs. The divisor is set against the
 * bake's own contact range, and the cap is what stops a slow machine paying
 * for detail it would then have to trace.
 *
 * Everything small comes out at one segment and costs nothing, which is most
 * of the room — a cabinet rail does not need to know about any of this.
 */
export const seg = (size: number, per = 620) =>
  Math.max(1, Math.min(quality().maxSegments, Math.round(Math.abs(size) / per)));

/** Segments around a curve, thinned on machines that would rather not. */
export const arc = (n: number) => {
  const tier = quality().tier;
  return Math.max(5, Math.round(n * (tier === 'low' ? 0.55 : tier === 'medium' ? 0.8 : 1)));
};

export function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A wall, a floor, a ceiling: a plane with enough vertices to be lit. */
export function panel(w: number, h: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, seg(w), seg(h)), material);
  m.receiveShadow = true;
  return m;
}

export function cylinder(
  rt: number,
  rb: number,
  h: number,
  material: THREE.Material,
  segments = 20,
  open = false,
) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, h, arc(segments), seg(h, 900), open),
    material,
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * A rectangle with a rectangle taken out of it — a wall with a window in it.
 *
 * Four panels round the opening rather than one triangulated shape. A
 * `ShapeGeometry` of a wall with a hole in it comes back as a dozen long
 * triangles reaching from corner to corner, which is the correct silhouette
 * and a hopeless place to store light: a baked reveal needs vertices near the
 * opening, and that triangulation puts them only at the corners of the room.
 * Cut it into four rectangles and each one can be divided as finely as its
 * own size deserves.
 *
 * UVs stay in wall space over a fixed 2200, exactly as the shape version had
 * them, so the tiling runs continuously across all four pieces and the seam
 * where they meet is invisible.
 */
export function pierced(w: number, h: number, hole: THREE.Box2) {
  const { min, max } = hole;
  const rects: Array<[number, number, number, number]> = [
    [-w / 2, -h / 2, w / 2, min.y], // under the opening
    [-w / 2, max.y, w / 2, h / 2], // over it
    [-w / 2, min.y, min.x, max.y], // and the jambs either side
    [max.x, min.y, w / 2, max.y],
  ];

  const parts: THREE.BufferGeometry[] = [];
  for (const [x0, y0, x1, y1] of rects) {
    const pw = x1 - x0;
    const ph = y1 - y0;
    if (pw <= 1 || ph <= 1) continue;
    const g = new THREE.PlaneGeometry(pw, ph, seg(pw), seg(ph));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    const position = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, position.getX(i) / 2200, position.getY(i) / 2200);
    }
    parts.push(g);
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged ?? new THREE.PlaneGeometry(w, h);
}

/* ---------------------------------------------------------------- foliage */

let sprig: THREE.Texture | null = null;

/**
 * A sprig of leaves on a transparent card.
 *
 * Plants are the one thing in a room that cannot be boxes, and modelling them
 * properly costs more than the entire rest of the scene. Cards with an alpha
 * cutout are what games have always used, and at any distance you can actually
 * orbit to they are indistinguishable from the real thing.
 */
export function sprigTexture() {
  if (sprig) return sprig;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const stem = (x0: number, y0: number, x1: number, y1: number, leaves: number, size: number) => {
    ctx.strokeStyle = '#4c6136';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + 22, (y0 + y1) / 2, x1, y1);
    ctx.stroke();
    for (let i = 1; i <= leaves; i++) {
      const t = i / (leaves + 1);
      const px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ((x0 + x1) / 2 + 22) + t * t * x1;
      const py = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2) + t * t * y1;
      for (const side of [-1, 1]) {
        const a = side * (0.7 + Math.random() * 0.4) - 0.5;
        const r = size * (0.7 + Math.random() * 0.5) * (1 - t * 0.35);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, r, 0);
        g.addColorStop(0, '#3c5228');
        g.addColorStop(1, '#7d9a58');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(r * 0.5, 0, r * 0.5, r * 0.26, 0, 0, 7);
        ctx.fill();
        ctx.restore();
      }
    }
  };
  stem(128, 250, 128, 40, 6, 46);
  stem(128, 250, 40, 90, 5, 40);
  stem(128, 250, 216, 96, 5, 40);
  sprig = new THREE.CanvasTexture(c);
  sprig.colorSpace = THREE.SRGBColorSpace;
  return sprig;
}

/** A bush of cards, fanned around an axis so it has volume from every side. */
export function foliage(count: number, spread: number, height: number, droop = 0): THREE.Group {
  const g = new THREE.Group();
  /*
   * Cut out, not transparent. Marking these `transparent` put dozens of cards
   * into the sorted transparent pass, where their draw order is recomputed
   * from camera distance every frame — and cards at nearly equal distance swap
   * places as you move, which is what made the plants shimmer. With alphaTest
   * alone they render in the opaque pass against the depth buffer, which is
   * both stable and correct.
   */
  const mat = new THREE.MeshStandardMaterial({
    map: sprigTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.78,
  });
  /* Fewer cards on a slow machine, each a little larger, so a bush thins out
     rather than shrinking — the silhouette is what you read at this distance,
     and it survives losing a third of the cards inside it. */
  const cards = Math.max(3, Math.round(count * quality().foliageScale));
  const gain = Math.sqrt(count / cards);

  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI * 2 + Math.random() * 0.5;
    const s = height * (0.66 + Math.random() * 0.5) * gain;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.9, s), mat);
    card.position.set(Math.cos(a) * spread * 0.35, s * 0.38 - droop * Math.random(), Math.sin(a) * spread * 0.35);
    card.rotation.set((Math.random() - 0.5) * 0.5 + droop * 0.0006, -a, (Math.random() - 0.5) * 0.7);
    card.castShadow = true;
    g.add(card);
  }
  return g;
}

/* ------------------------------------------------------------------- glow */

let glowTex: THREE.Texture | null = null;

function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  // a long, soft tail — a hard-edged falloff reads as a decal, not as light
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.34, 'rgba(255,255,255,0.24)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/**
 * Bloom, faked.
 *
 * A real bloom pass means rendering the scene to a target, extracting the
 * bright parts, blurring them across several half-size buffers and compositing
 * back — five or six full-screen passes for an effect that, here, only ever
 * happens around two bulbs whose positions are known. Additive billboards at
 * those positions cost two draws and no passes at all, and because they are
 * excluded from tone mapping they keep the hot centre a real bloom would
 * flatten.
 */
export function glowSprite(color: number, size: number, opacity: number) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Depth-tested on purpose. Drawing bloom over the top of everything makes
      // the shade it hangs inside glow warm along with the bulb, and a black
      // shade that has turned brass is a worse artefact than the one it fixes.
      // The billboard is centred just below the rim, so the dome occludes its
      // upper half exactly as it occludes the light.
      toneMapped: false,
    }),
  );
  s.renderOrder = 10;
  s.scale.set(size, size, 1);
  return s;
}

/** Two or three nested sprites: a hot core inside a wide, faint halo. */
export function bloom(color: number, core: number, halo: number, strength = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(glowSprite(color, core, 0.95 * strength));
  g.add(glowSprite(color, halo * 0.5, 0.4 * strength));
  g.add(glowSprite(color, halo, 0.18 * strength));
  return g;
}

let coneFade: THREE.Texture | null = null;

/**
 * Light you can see the shape of, hanging under a shade.
 *
 * The fade down its length is not decoration — a cone of even brightness has
 * a hard rim top and bottom and reads as a translucent plastic funnel, which
 * is what the first attempt looked like. Air lit by a lamp is brightest right
 * under the shade and gone a metre later.
 */
export function lightCone(color: number, topR: number, bottomR: number, height: number, strength: number) {
  if (!coneFade) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
    coneFade = new THREE.CanvasTexture(c);
    coneFade.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.Mesh(
    new THREE.CylinderGeometry(topR, bottomR, height, 26, 1, true),
    new THREE.MeshBasicMaterial({
      map: coneFade,
      color,
      transparent: true,
      opacity: 0.42 * strength,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
}

/* ----------------------------------------------------------------- shafts */

let shaftFade: THREE.Texture | null = null;
let poolFade: THREE.Texture | null = null;

/** Bright at the window, gone by the floor, and feathered down both edges. */
function shaftTexture() {
  if (shaftFade) return shaftFade;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const along = ctx.createLinearGradient(0, 128, 0, 0);
  along.addColorStop(0, 'rgba(255,255,255,0.85)');
  along.addColorStop(0.35, 'rgba(255,255,255,0.44)');
  along.addColorStop(0.78, 'rgba(255,255,255,0.1)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 64, 128);
  // a hard-edged beam is a plank of perspex; air has no edges
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.3, 'rgba(0,0,0,1)');
  across.addColorStop(0.7, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 64, 128);
  shaftFade = new THREE.CanvasTexture(c);
  shaftFade.colorSpace = THREE.SRGBColorSpace;
  return shaftFade;
}

/** The patch where the beam lands, soft on every side. */
function poolTexture() {
  if (poolFade) return poolFade;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  poolFade = new THREE.CanvasTexture(c);
  poolFade.colorSpace = THREE.SRGBColorSpace;
  return poolFade;
}

function additive(map: THREE.Texture, color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/**
 * A beam of daylight, as two crossed cards.
 *
 * The honest version of this is a volumetric: march the depth buffer along the
 * light's direction, sampling the shadow map at every step, once per pixel per
 * frame. It is the single most expensive thing in a real-time renderer, and it
 * is being asked to draw something whose position, direction and length are
 * all known constants — the window has not moved.
 *
 * Two cards crossed at right angles along the beam axis read as a beam from
 * anywhere in the arc the camera is leashed to, for two draws and no passes,
 * which is the same bargain the bloom takes. They are deliberately dim: a
 * shaft you notice is a shaft that has gone wrong, and the job is only to put
 * some air between the window and the floor.
 */
export function shaft(
  from: THREE.Vector3Like,
  towards: THREE.Vector3Like,
  length: number,
  width: number,
  color: number,
  strength = 1,
): THREE.Group {
  const g = new THREE.Group();
  const material = additive(shaftTexture(), color, 0.3 * strength);
  const geometry = new THREE.PlaneGeometry(width, length);
  geometry.translate(0, length / 2, 0);

  for (const turn of [0, Math.PI / 2]) {
    const card = new THREE.Mesh(geometry, material);
    card.rotation.y = turn;
    g.add(still(card));
  }
  g.position.set(from.x, from.y, from.z);
  g.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(towards.x, towards.y, towards.z).normalize(),
  );
  g.renderOrder = 8;
  return still(g);
}

/** Where it lands: a soft additive patch, lying flat on the floor. */
export function lightPool(
  at: THREE.Vector3Like,
  w: number,
  d: number,
  color: number,
  strength = 1,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), additive(poolTexture(), color, 0.3 * strength));
  m.rotation.x = -Math.PI / 2;
  m.position.set(at.x, at.y, at.z);
  m.renderOrder = 7;
  return still(m);
}
