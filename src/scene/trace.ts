/**
 * The ray tracer, and nothing else.
 *
 * Deliberately free of three.js, of the DOM, and of anything that knows what a
 * room is: it takes a bag of triangles and a list of points, and hands back a
 * colour for each point. That is what lets the same code run on the main
 * thread and inside a worker without a second copy of a rendering library
 * being bundled to reach it.
 *
 * The physics it implements is one bounce of a path tracer, evaluated on the
 * assumption that the incoming light is the same from every direction — which
 * is exactly the assumption ambient occlusion is. Every point fires a few
 * dozen cosine-weighted rays over its hemisphere; how many come back blocked
 * is how much of the sky it cannot see, and what colour the blockers were is
 * what its neighbours are lending it.
 */

/* ------------------------------------------------------------------- BVH */

/**
 * A bounding volume hierarchy, median-split.
 *
 * Median rather than the surface-area heuristic: an SAH build is several times
 * the cost and a couple of hundred more lines, to win perhaps a third of the
 * traversal on a few thousand triangles that get traced once. The room is also
 * mostly axis-aligned boxes, which is the case a median split handles least
 * badly.
 */
class Bvh {
  private readonly bounds: Float32Array;
  private readonly right: Int32Array;
  private readonly start: Int32Array;
  private readonly count: Int32Array;
  private readonly order: Uint32Array;
  private readonly stack = new Int32Array(64);
  private nodes = 0;

  constructor(private readonly pos: Float32Array, triangles: number) {
    const max = Math.max(2, triangles * 2);
    this.bounds = new Float32Array(max * 6);
    this.right = new Int32Array(max).fill(-1);
    this.start = new Int32Array(max);
    this.count = new Int32Array(max);
    this.order = new Uint32Array(triangles);
    for (let i = 0; i < triangles; i++) this.order[i] = i;

    const centroid = new Float32Array(triangles * 3);
    for (let i = 0; i < triangles; i++) {
      const p = i * 9;
      centroid[i * 3] = (pos[p] + pos[p + 3] + pos[p + 6]) / 3;
      centroid[i * 3 + 1] = (pos[p + 1] + pos[p + 4] + pos[p + 7]) / 3;
      centroid[i * 3 + 2] = (pos[p + 2] + pos[p + 5] + pos[p + 8]) / 3;
    }
    this.build(0, triangles, centroid, 0);
  }

  private build(from: number, to: number, centroid: Float32Array, depth: number): number {
    const node = this.nodes++;
    const b = node * 6;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = from; i < to; i++) {
      const p = this.order[i] * 9;
      for (let v = 0; v < 9; v += 3) {
        const x = this.pos[p + v];
        const y = this.pos[p + v + 1];
        const z = this.pos[p + v + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }
    this.bounds[b] = minX; this.bounds[b + 1] = minY; this.bounds[b + 2] = minZ;
    this.bounds[b + 3] = maxX; this.bounds[b + 4] = maxY; this.bounds[b + 5] = maxZ;

    const n = to - from;
    if (n <= 6 || depth >= 28) {
      this.start[node] = from;
      this.count[node] = n;
      return node;
    }

    const ex = maxX - minX;
    const ey = maxY - minY;
    const ez = maxZ - minZ;
    const axis = ex > ey ? (ex > ez ? 0 : 2) : ey > ez ? 1 : 2;
    /* A plain array and a plain sort. `TypedArray#sort` with a comparator
       looks like the thrifty version of this and is markedly slower: V8 has a
       fast path for typed arrays only when sorting them numerically, and
       passing a comparator drops it onto the generic one. */
    const slice = Array.from(this.order.subarray(from, to));
    slice.sort((a, c) => centroid[a * 3 + axis] - centroid[c * 3 + axis]);
    this.order.set(slice, from);

    const mid = from + (n >> 1);
    this.count[node] = 0;
    this.build(from, mid, centroid, depth + 1);
    this.right[node] = this.build(mid, to, centroid, depth + 1);
    return node;
  }

  /**
   * The nearest blocker along a ray, packed as distance and triangle.
   *
   * One traversal answers both of the questions the bake asks — how far away
   * the nearest blocker is, and what colour it was — so the bounce term comes
   * free once the occlusion term has been paid for. The result is returned
   * through a caller-owned pair rather than an object, because this is called
   * a hundred thousand times and more, and an allocation per call is a
   * hundred thousand allocations.
   */
  hit(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
    out: Float64Array,
  ): void {
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const bounds = this.bounds;
    const order = this.order;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    let best = maxDist;
    let bestTri = -1;

    while (sp > 0) {
      const node = stack[--sp];
      const b = node * 6;
      // slab test; a zero direction component yields infinities that fall out
      let t0 = (bounds[b] - ox) * ix;
      let t1 = (bounds[b + 3] - ox) * ix;
      let near = t0 < t1 ? t0 : t1;
      let far = t0 < t1 ? t1 : t0;

      t0 = (bounds[b + 1] - oy) * iy;
      t1 = (bounds[b + 4] - oy) * iy;
      if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
      if (t0 > near) near = t0;
      if (t1 < far) far = t1;

      t0 = (bounds[b + 2] - oz) * iz;
      t1 = (bounds[b + 5] - oz) * iz;
      if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
      if (t0 > near) near = t0;
      if (t1 < far) far = t1;

      if (far < (near > 0 ? near : 0) || near >= best) continue;

      const n = this.count[node];
      if (n === 0) {
        stack[sp++] = this.right[node];
        stack[sp++] = node + 1;
        continue;
      }
      const end = this.start[node] + n;
      for (let i = this.start[node]; i < end; i++) {
        const tri = order[i];
        const t = this.triangle(tri, ox, oy, oz, dx, dy, dz, best);
        if (t > 0) {
          best = t;
          bestTri = tri;
        }
      }
    }
    out[0] = best;
    out[1] = bestTri;
  }

  /** Möller–Trumbore, double-sided: a room's walls are planes with one face. */
  private triangle(
    tri: number,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    best: number,
  ): number {
    const pos = this.pos;
    const p = tri * 9;
    const ax = pos[p], ay = pos[p + 1], az = pos[p + 2];
    const e1x = pos[p + 3] - ax, e1y = pos[p + 4] - ay, e1z = pos[p + 5] - az;
    const e2x = pos[p + 6] - ax, e2y = pos[p + 7] - ay, e2z = pos[p + 8] - az;

    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-9 && det < 1e-9) return -1;
    const inv = 1 / det;

    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;

    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 1e-4 && t < best ? t : -1;
  }
}

/* ---------------------------------------------------------------- tracing */

/** Contact range: a blocker this close is full occlusion. Forty centimetres. */
const NEAR = 1100;

/**
 * Room range, and the number the whole effect turns on.
 *
 * It has to be short. Set it to the size of the room and every surface in the
 * room is occluded by the room: the average comes out dark, the corners are no
 * darker *relative to* the walls than they were, and what was meant to be
 * shading reads as somebody having turned the lights down. At a metre and a
 * half it describes what a point is tucked into rather than what it is
 * standing in, which is the only part worth baking.
 *
 * It is also most of the cost — every unit of range is more of the tree that
 * each of a hundred and fifty thousand rays has to walk.
 */
const FAR = 4200;

export interface TraceJob {
  /** Points to shade, in world space, three floats each. */
  points: Float32Array;
  /** Their normals, in the same space. */
  normals: Float32Array;
  /** Occluders, nine floats a triangle. */
  tris: Float32Array;
  /** What each of those triangles throws back, three floats a triangle. */
  albedo: Float32Array;
  rays: number;
  /** How dark a fully enclosed point may get. Never zero — nowhere is. */
  floor: number;
  /** How much of a neighbour's colour an enclosed point picks up. */
  bleed: number;
}

/**
 * The van der Corput sequence, base two.
 *
 * Rays distributed by `Math.random` clump, and clumps in a thirty-ray estimate
 * show up as mottling across a flat wall — the one place the eye is best at
 * spotting it. A low-discrepancy sequence covers the hemisphere evenly for the
 * same number of rays, which is worth roughly twice as many of them.
 */
function radicalInverse(i: number): number {
  let bits = i;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits / 4294967296;
}

/** Shade every point in the job. Returns three floats each, to multiply into
 *  the surface's own colour. */
export function trace(job: TraceJob): Float32Array {
  const { points, normals, tris, albedo, rays, floor, bleed } = job;
  const count = points.length / 3;
  const out = new Float32Array(count * 3);
  if (!tris.length) return out.fill(1);

  const bvh = new Bvh(tris, tris.length / 9);
  const hit = new Float64Array(2);

  for (let i = 0; i < count; i++) {
    const px = points[i * 3];
    const py = points[i * 3 + 1];
    const pz = points[i * 3 + 2];
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];

    // an orthonormal basis around the normal, branchless (Duff et al.)
    const sign = nz >= 0 ? 1 : -1;
    const a = -1 / (sign + nz);
    const b = nx * ny * a;
    const t1x = 1 + sign * nx * nx * a;
    const t1y = sign * b;
    const t1z = -sign * nx;
    const t2x = b;
    const t2y = sign + ny * ny * a;
    const t2z = -ny;

    // lifted off the surface, or every ray starts by hitting its own triangle
    const ox = px + nx * 3;
    const oy = py + ny * 3;
    const oz = pz + nz * 3;

    /* Cranley–Patterson: one rotation of the sequence per point, so that
       neighbours do not all sample the same directions and turn a smooth
       gradient into a visible grid. */
    const jitter = ((i * 2654435761) >>> 0) / 4294967296;

    let near = 0;
    let far = 0;
    let br = 0, bg = 0, bb = 0, bw = 0;

    for (let s = 0; s < rays; s++) {
      const u1 = (s + jitter) / rays;
      const u2 = (radicalInverse(s + 1) + jitter) % 1;
      const r = Math.sqrt(u1);
      const phi = 2 * Math.PI * u2;
      const sx = r * Math.cos(phi);
      const sy = r * Math.sin(phi);
      const sz = Math.sqrt(1 - u1 > 0 ? 1 - u1 : 0);

      bvh.hit(
        ox, oy, oz,
        t1x * sx + t2x * sy + nx * sz,
        t1y * sx + t2y * sy + ny * sz,
        t1z * sx + t2z * sy + nz * sz,
        FAR,
        hit,
      );
      if (hit[1] < 0) continue;

      const t = hit[0];
      if (t < NEAR) near += 1 - t / NEAR;
      const w = 1 - t / FAR;
      far += w;
      const c = hit[1] * 3;
      br += albedo[c] * w;
      bg += albedo[c + 1] * w;
      bb += albedo[c + 2] * w;
      bw += w;
    }

    /*
     * Two ranges, one traversal.
     *
     * Contact darkening and room darkening are different effects and want
     * different weights: the seam where a drawer meets a worktop is nearly
     * black, while the far corner of a room is merely dim. Reading both off
     * the same hit distance gives shadows that harden as they approach the
     * thing casting them, which is the clearest single tell of a traced image
     * against a rasterised one.
     */
    let shade = 1 - (0.6 * near) / rays - (0.17 * far) / rays;
    if (shade < floor) shade = floor;

    /* The bounce is a hue, not a brightness. Dividing it by its own mean
       leaves only which way it leans, so a warm floor warms the shelf above it
       without also lighting it — light the bake has no business adding, since
       the room's actual lamps are already accounted for. */
    let tr = 1, tg = 1, tb = 1;
    if (bw > 0) {
      const mean = (br + bg + bb) / (3 * bw) || 1;
      const amount = bleed * (far / rays < 1 ? far / rays : 1);
      tr = 1 + amount * (br / bw / mean - 1);
      tg = 1 + amount * (bg / bw / mean - 1);
      tb = 1 + amount * (bb / bw / mean - 1);
    }

    out[i * 3] = shade * tr;
    out[i * 3 + 1] = shade * tg;
    out[i * 3 + 2] = shade * tb;
  }

  return out;
}
