import * as THREE from 'three';

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

export function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cylinder(
  rt: number,
  rb: number,
  h: number,
  material: THREE.Material,
  seg = 20,
  open = false,
) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A rectangle with a rectangle taken out of it — a wall with a window in it. */
export function pierced(w: number, h: number, hole: THREE.Box2) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.closePath();
  const cut = new THREE.Path();
  cut.moveTo(hole.min.x, hole.min.y);
  cut.lineTo(hole.min.x, hole.max.y);
  cut.lineTo(hole.max.x, hole.max.y);
  cut.lineTo(hole.max.x, hole.min.y);
  cut.closePath();
  shape.holes.push(cut);
  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry hands back UVs in shape space; scale them into tiling range
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2200, uv.getY(i) / 2200);
  return g;
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
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const s = height * (0.66 + Math.random() * 0.5);
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
