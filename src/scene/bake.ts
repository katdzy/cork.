import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { trace, type TraceJob } from './trace';

/**
 * The lighting, traced — once, before anybody has moved.
 *
 * Everything a rasteriser is bad at is everything a room is made of: the
 * darkening where two walls meet, the shadow a counter sits in that no lamp
 * actually casts, the warmth an oak floor throws up onto the underside of the
 * worktop above it. A shadow map has nothing to say about any of it. They are
 * all visibility questions — what can this point see — and the way to answer a
 * visibility question is to fire a ray and find out.
 *
 * So that is what happens. The room's own triangles go into a BVH and every
 * vertex fires a few dozen cosine-weighted rays over its hemisphere; the
 * answers are folded into the vertex colour attribute, which the standard
 * material already multiplies into its diffuse term for nothing. The results
 * are the ones a path tracer gives at one bounce, and they cost exactly
 * nothing per frame, because the room they describe never moves.
 *
 * That is the trade the whole scene is built on. The alternative, SSAO, is a
 * depth pass and a blur on every frame for the rest of the session, to
 * approximate at half resolution what is sitting in a buffer here already —
 * and it still cannot do the colour bleed at all.
 *
 * This file is the three.js half: what to trace, and where to put the answer.
 * The tracing itself is in `trace.ts`, which knows nothing about three.js so
 * that it can run in a worker without one.
 */

/* ------------------------------------------------------------- dispatching */

type Pending = (colours: Float32Array) => void;

let worker: Worker | null = null;
let workerBroken = false;
let nextJob = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; colours: Float32Array }>) => {
      const done = pending.get(event.data.id);
      pending.delete(event.data.id);
      done?.(event.data.colours);
    };
    worker.onerror = () => {
      // Whatever went wrong, the room still has to get lit.
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const [id, done] of pending) {
        pending.delete(id);
        done(new Float32Array(0));
      }
    };
  } catch {
    workerBroken = true;
  }
  return worker;
}

function dispatch(job: TraceJob, done: Pending) {
  const w = ensureWorker();
  if (!w) {
    /* No workers — an old browser, or a policy that forbids them. Trace on the
       main thread, but after the current frame, so the room is at least on
       screen before it goes quiet. */
    setTimeout(() => done(trace(job)), 0);
    return;
  }
  const id = nextJob++;
  pending.set(id, done);
  w.postMessage({ id, job }, [
    job.points.buffer,
    job.normals.buffer,
    job.tris.buffer,
    job.albedo.buffer,
  ]);
}

/** Stop waiting on anything still in flight — the scene it belonged to is gone. */
export function cancelBakes() {
  pending.clear();
  worker?.terminate();
  worker = null;
  workerBroken = false;
  // keyed by texture uuid, and the textures are about to be thrown away
  averages.clear();
}

/* ---------------------------------------------------------------- gathering */

/** The average colour of a texture, from a one-pixel draw of it. */
const averages = new Map<string, [number, number, number]>();

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function averageOf(texture: THREE.Texture): [number, number, number] {
  const hit = averages.get(texture.uuid);
  if (hit) return hit;
  let out: [number, number, number] = [1, 1, 1];
  try {
    const image = texture.image as CanvasImageSource | undefined;
    if (image) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      // the canvas is sRGB and the bounce arithmetic is linear
      out = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
    }
  } catch {
    /* a tainted or zero-sized canvas: white is a safe thing to bounce */
  }
  averages.set(texture.uuid, out);
  return out;
}

/**
 * What a surface throws back.
 *
 * Its tint times the average of its map, and the map matters: nearly every
 * material in these rooms is white with a texture on it, so reading only
 * `color` would have the oak floor bouncing pure white onto the counter above
 * it. A single pixel's worth of the texture is all the bounce needs, since
 * what comes out of it is a hue and not an image.
 */
function albedoOf(material: THREE.Material): [number, number, number] {
  const m = material as THREE.MeshStandardMaterial;
  const c = m.color ?? new THREE.Color(1, 1, 1);
  const avg = m.map ? averageOf(m.map) : ([1, 1, 1] as [number, number, number]);
  return [c.r * avg[0], c.g * avg[1], c.b * avg[2]];
}

type Standard = THREE.MeshStandardMaterial;

const isStandard = (m: THREE.Material) =>
  (m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial === true;

/** Opaque, lit, and not a cut-out card: the things worth tracing against. */
function isSolid(mesh: THREE.Mesh): boolean {
  const m = mesh.material as Standard;
  if (!m || Array.isArray(m) || !m.isMaterial) return false;
  if (m.transparent || (m.opacity ?? 1) < 1) return false;
  if (m.alphaTest > 0) return false;
  return isStandard(m);
}

/** Lit, but a cut-out: it takes vertex colour, it just doesn't block light. */
function isCutout(mesh: THREE.Mesh): boolean {
  const m = mesh.material as Standard;
  if (!m || Array.isArray(m)) return false;
  return isStandard(m) && m.alphaTest > 0 && !m.transparent;
}

function occluders(root: THREE.Object3D, ground: number | null): { tris: Float32Array; albedo: Float32Array } {
  const pos: number[] = [];
  const albedo: number[] = [];
  const v = new THREE.Vector3();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !isSolid(mesh)) return;
    const g = mesh.geometry;
    const p = g.attributes.position as THREE.BufferAttribute;
    if (!p) return;
    const index = g.index;
    const count = index ? index.count / 3 : p.count / 3;
    const [ar, ag, ab] = albedoOf(mesh.material as THREE.Material);
    for (let t = 0; t < count; t++) {
      for (let k = 0; k < 3; k++) {
        const i = index ? index.getX(t * 3 + k) : t * 3 + k;
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        pos.push(v.x, v.y, v.z);
      }
      albedo.push(ar, ag, ab);
    }
  });

  /*
   * An implicit floor under the props.
   *
   * A mug traced against only its own triangles has nothing underneath it, so
   * it gets no contact darkening where it meets the counter — the one piece of
   * occlusion you would actually notice on something that small. The counter
   * cannot be in the ray set, because a prop can be picked up and put down
   * somewhere else and the bake has to stay true wherever it lands. A plane at
   * its feet is true everywhere, since the only place a prop is ever put down
   * is on one.
   */
  if (ground !== null) {
    const r = 9000;
    for (const [x, y, z] of [
      [-r, ground, -r], [r, ground, -r], [r, ground, r],
      [-r, ground, -r], [r, ground, r], [-r, ground, r],
    ]) {
      pos.push(x, y, z);
    }
    albedo.push(0.42, 0.3, 0.19, 0.42, 0.3, 0.19);
  }

  return { tris: new Float32Array(pos), albedo: new Float32Array(albedo) };
}

/* -------------------------------------------------------------------- bake */

export interface BakeOptions {
  /** Total rays to spend here, shared out over however many vertices there are. */
  rayBudget: number;
  /** How dark a fully enclosed vertex may get. */
  floor?: number;
  /** How much of a neighbour's colour bleeds onto an enclosed surface. */
  bleed?: number;
  /** Height of an implicit floor, for a group that sits on one. */
  ground?: number | null;
  /** Called when the light has landed, on a later frame than the call. */
  settled?(): void;
}

/**
 * Trace a group, and write the result into its vertex colours.
 *
 * Returns immediately, having given everything white: a material reading
 * vertex colours from a geometry that has none renders black, so the
 * attributes go on straight away and are overwritten when the trace comes
 * back. The room is therefore correct on the first frame and lit on a later
 * one, rather than correct on neither.
 */
export function bakeLight(root: THREE.Object3D, options: BakeOptions): void {
  const { rayBudget, floor = 0.34, bleed = 0.5, ground = null, settled } = options;
  root.updateMatrixWorld(true);

  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    if (!isSolid(mesh) && !isCutout(mesh)) return;
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();

    const count = (mesh.geometry.attributes.position as THREE.BufferAttribute).count;
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    (mesh.material as Standard).vertexColors = true;
    mesh.userData.baked = true;
    /* Cut-out cards keep the white. A leaf is a rectangle with a plant painted
       on it, so tracing one shades the whole rectangle — including the corners
       that are not there. */
    if (isSolid(mesh)) targets.push(mesh);
  });

  if (!targets.length) {
    settled?.();
    return;
  }

  const { tris, albedo } = occluders(root, ground);
  if (!tris.length) {
    settled?.();
    return;
  }

  let vertices = 0;
  for (const mesh of targets) vertices += (mesh.geometry.attributes.position as THREE.BufferAttribute).count;

  const points = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const spans: Array<{ mesh: THREE.Mesh; at: number; count: number }> = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  let at = 0;
  for (const mesh of targets) {
    const position = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const normal = mesh.geometry.attributes.normal as THREE.BufferAttribute;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      const o = (at + i) * 3;
      points[o] = v.x; points[o + 1] = v.y; points[o + 2] = v.z;
      normals[o] = n.x; normals[o + 1] = n.y; normals[o + 2] = n.z;
    }
    spans.push({ mesh, at, count: position.count });
    at += position.count;
  }

  /*
   * Rays are shared out rather than fixed per vertex, so a room that grows a
   * cabinet run gets a slightly coarser trace instead of a slower one. Thirty
   * or so is where a low-discrepancy hemisphere stops visibly improving;
   * below about a dozen the mottling comes back.
   */
  const rays = Math.max(8, Math.min(36, Math.round(rayBudget / vertices)));

  dispatch({ points, normals, tris, albedo, rays, floor, bleed }, (colours) => {
    if (colours.length === vertices * 3) {
      for (const span of spans) {
        const attribute = span.mesh.geometry.attributes.color as THREE.BufferAttribute | undefined;
        if (!attribute) continue;
        (attribute.array as Float32Array).set(
          colours.subarray(span.at * 3, (span.at + span.count) * 3),
        );
        attribute.needsUpdate = true;
      }
    }
    settled?.();
  });
}

/* ----------------------------------------------------------------- merging */

/**
 * Fold a group down into one mesh per material.
 *
 * A room of a hundred and fifty boxes is a hundred and fifty draw calls, and
 * then a hundred and fifty more for every shadow-casting light that looks at
 * it. None of them move — they were all frozen with `still` — so their
 * matrices can be written into their vertices and the geometry concatenated,
 * which turns a whole cabinet run into a single call. On a mobile GPU, where
 * the per-draw cost is most of the frame, that is the difference between
 * scrolling and not.
 *
 * It is safe precisely because nothing in a room is ever picked: raycasting
 * only ever runs against the props, and those are merged one prop at a time so
 * that each stays a thing you can grab.
 */
export function mergeStatic(root: THREE.Object3D): { before: number; after: number } {
  root.updateMatrixWorld(true);
  /*
   * Folded into the root's own frame, not the world's.
   *
   * A room sits at the origin and the distinction never comes up. A prop does
   * not: it is a group standing somewhere on a counter, and writing its world
   * matrix into its own vertices would apply that position a second time the
   * moment the group's transform was composed on top of them.
   */
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const matrix = new THREE.Matrix4();

  const batches = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[] }>();
  const folded: THREE.Mesh[] = [];

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.userData.baked || mesh.userData.noMerge) return;
    const material = mesh.material as THREE.Material;
    if (Array.isArray(material)) return;
    const g = mesh.geometry;
    if (!g.index || !g.attributes.position || !g.attributes.normal || !g.attributes.uv || !g.attributes.color) return;
    const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
    const batch = batches.get(key) ?? { material, meshes: [] };
    batch.meshes.push(mesh);
    batches.set(key, batch);
  });

  let before = 0;
  let after = 0;
  for (const batch of batches.values()) {
    before += batch.meshes.length;
    if (batch.meshes.length < 2) {
      after += batch.meshes.length;
      continue;
    }
    const parts = batch.meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(matrix.multiplyMatrices(toLocal, m.matrixWorld));
      // Merging is by attribute name, and one stray extra sinks the batch.
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') {
          g.deleteAttribute(name);
        }
      }
      return g;
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (!merged) {
      after += batch.meshes.length;
      continue;
    }

    const first = batch.meshes[0];
    const mesh = new THREE.Mesh(merged, batch.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.userData.baked = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    folded.push(mesh);
    after += 1;

    for (const m of batch.meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
  }

  for (const mesh of folded) root.add(mesh);
  return { before, after };
}
