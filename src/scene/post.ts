import * as THREE from 'three';
import { quality } from './quality';

/**
 * Everything that happens to the frame after the room is in it.
 *
 * Until now the room went straight to the screen: one `render`, tone mapped in
 * the material shaders, and whatever came out was what you saw. Which is
 * honest, and leaves the two things a lens actually does undone. A bright
 * window does not stop at the edge of the window — it spills into the wall
 * beside it, because the light scatters inside the glass and inside the eye.
 * And air is not empty: the light coming through that window picks out the
 * dust between it and the worktop in visible bands.
 *
 * Both used to be faked with geometry. Additive billboards stood in for the
 * spill and two crossed cards stood in for the bands, and both were placed by
 * hand at positions known in advance — which works exactly as long as nothing
 * is unexpectedly bright and the camera stays where you thought it would. A
 * laptop screen, a brass pull catching the sun, the white rim of a mug: none
 * of those could be given a sprite, and all of them should bloom.
 *
 * So the frame is rendered into a floating-point buffer instead, where a
 * highlight is allowed to be four times as bright as white rather than being
 * clipped at it, and the spill and the bands are measured off that buffer
 * rather than placed. The tone curve then runs here, at the end, over the
 * whole composite — which is the only place it can run if the bloom is to be
 * added in the linear light it belongs to.
 *
 * The cost is real and it is bounded: one extra full-screen pass to prefilter,
 * a pyramid of progressively smaller ones to blur, one radial pass for the
 * bands, and one to put it together. All of them are at half resolution or
 * below except the last. And every one of them happens only on a frame that
 * was going to be drawn anyway — the room is still drawn on demand, and a
 * still camera still costs nothing at all.
 */

/* ------------------------------------------------------------- the quad */

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * One triangle, not two.
 *
 * A screen-filling quad is two triangles meeting along the diagonal, and every
 * pixel on that diagonal is rasterised by both of them — a seam of double work
 * straight across the middle of every pass. A single triangle twice the size
 * of the screen covers it with no seam, and the parts hanging off the edges
 * are clipped before they cost anything.
 */
function screenTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return g;
}

/** Draws one shader over one target, and nothing else. */
class Blit {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly mesh: THREE.Mesh;
  private readonly geometry = screenTriangle();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.mesh = new THREE.Mesh(this.geometry);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /**
   * `clear` is a real question here, and `autoClear` has to be turned off to
   * be allowed to answer it.
   *
   * `WebGLRenderer.render` clears the target it has been pointed at before it
   * draws anything, unless told not to — which is right for a scene and
   * exactly wrong for the upsample below, whose entire purpose is to add onto
   * what is already in the buffer. Left alone it wipes each level of the
   * pyramid immediately before adding the level above it to it, and the sum
   * of six scales quietly becomes the coarsest one on its own: a bloom that
   * still looks like a bloom, with none of the fine halo that makes it sit on
   * the object rather than float near it.
   */
  to(target: THREE.WebGLRenderTarget | null, material: THREE.RawShaderMaterial | THREE.ShaderMaterial, clear = true) {
    this.mesh.material = material;
    this.renderer.setRenderTarget(target);
    const auto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    if (clear) this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = auto;
  }

  dispose() {
    this.geometry.dispose();
  }
}

function pass(fragment: string, uniforms: Record<string, THREE.IUniform>, defines?: Record<string, string | number>) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragment,
    uniforms,
    // spelled out rather than passed as undefined, which three warns about
    ...(defines ? { defines } : {}),
    depthTest: false,
    depthWrite: false,
  });
}

/* ------------------------------------------------------------- prefilter */

/**
 * What counts as bright, and how bright it is allowed to be.
 *
 * The threshold has a knee rather than a cliff: a hard cutoff makes a surface
 * that crosses it gradually — a worktop sliding into sunlight — pop as the
 * bloom switches on over it, and the eye is extremely good at spotting that.
 * The clamp above it is the opposite worry. One stray pixel at forty times
 * white, which a specular highlight on brass can easily produce, would blur
 * out into a visible disc that flickers as the camera moves; capping the input
 * costs nothing on anything that is genuinely a bright *area*.
 *
 * The weighted average is Karis's: each tap counted as 1/(1+luma) so that the
 * single hot pixel in a group cannot drag the whole group with it. This is the
 * standard defence against the crawling fireflies that otherwise appear along
 * every high-contrast edge as the camera turns.
 */
const PREFILTER = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
uniform float ceiling;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 bright(vec2 uv) {
  vec3 c = min(texture2D(tSrc, uv).rgb, vec3(ceiling));
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  return c * max(soft, b - threshold) / max(b, 1e-4);
}

void main() {
  /* The step here is the source texel scaled by how far down the pyramid the
     first buffer sits, so the four taps always straddle the pixels that are
     about to be merged into one. Left at one source texel while the target
     was a quarter of the screen, three of every four pixels would simply be
     skipped, and skipped pixels are what makes a bloom crawl. */
  vec3 a = bright(vUv + texel * vec2(-1.0, -1.0));
  vec3 b = bright(vUv + texel * vec2( 1.0, -1.0));
  vec3 c = bright(vUv + texel * vec2(-1.0,  1.0));
  vec3 d = bright(vUv + texel * vec2( 1.0,  1.0));
  float wa = 1.0 / (1.0 + luma(a));
  float wb = 1.0 / (1.0 + luma(b));
  float wc = 1.0 / (1.0 + luma(c));
  float wd = 1.0 / (1.0 + luma(d));
  gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}
`;

/**
 * Down the pyramid: thirteen taps, arranged as a box and a cross.
 *
 * A plain bilinear halving loses every other texel, and what it loses shows up
 * as the bloom shimmering while the camera moves — the same aliasing a mipmap
 * chain exists to prevent, except that this chain is rebuilt every frame and
 * so the shimmer is in motion. The thirteen-tap filter samples a full two
 * texels out in both rings, which is what makes the result stable.
 */
const DOWN = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
vec3 t(vec2 o) { return texture2D(tSrc, vUv + texel * o).rgb; }
void main() {
  vec3 a = t(vec2(-2.0,  2.0)), b = t(vec2(0.0,  2.0)), c = t(vec2(2.0,  2.0));
  vec3 d = t(vec2(-2.0,  0.0)), e = t(vec2(0.0,  0.0)), f = t(vec2(2.0,  0.0));
  vec3 g = t(vec2(-2.0, -2.0)), h = t(vec2(0.0, -2.0)), i = t(vec2(2.0, -2.0));
  vec3 j = t(vec2(-1.0,  1.0)), k = t(vec2(1.0,  1.0));
  vec3 l = t(vec2(-1.0, -1.0)), m = t(vec2(1.0, -1.0));
  vec3 o = e * 0.125;
  o += (a + c + g + i) * 0.03125;
  o += (b + d + f + h) * 0.0625;
  o += (j + k + l + m) * 0.125;
  gl_FragColor = vec4(o, 1.0);
}
`;

/**
 * And back up: a tent filter, added rather than written.
 *
 * Every level is added onto the one below it on the way up, so the finest
 * buffer ends up holding the sum of every scale at once — a tight halo around
 * a bright edge and a very wide, very faint one further out, from the same
 * pyramid. That is what makes the spill fall off the way a real one does
 * instead of looking like a single blur of a single radius.
 */
const UP = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float radius;
varying vec2 vUv;
vec3 t(vec2 o) { return texture2D(tSrc, vUv + texel * o * radius).rgb; }
void main() {
  vec3 s = t(vec2(-1.0,  1.0)) + t(vec2(0.0,  1.0)) * 2.0 + t(vec2(1.0,  1.0));
  s += t(vec2(-1.0, 0.0)) * 2.0 + t(vec2(0.0, 0.0)) * 4.0 + t(vec2(1.0, 0.0)) * 2.0;
  s += t(vec2(-1.0, -1.0)) + t(vec2(0.0, -1.0)) * 2.0 + t(vec2(1.0, -1.0));
  gl_FragColor = vec4(s * 0.0625, 1.0);
}
`;

/**
 * The bands in the air, marched outward from where the light comes in.
 *
 * This is the one effect here that genuinely is a trace, and the trick is what
 * it traces *through*. The prefiltered buffer is already an occlusion map for
 * free: it is bright where the window is and black everywhere a mullion, a
 * shelf or a person's shoulder is standing in front of it. Walking a line from
 * each pixel back toward the window and summing what is found along it,
 * dimming with distance, is exactly the integral a volumetric pass evaluates
 * — only taken across the image rather than through the depth buffer, and at a
 * quarter resolution where nobody can tell.
 *
 * What makes it read as air rather than as a smear is that the sum respects
 * the blockers: the bands genuinely stop where something opaque is in the way,
 * and genuinely fan out between the mullions. No card can do that, and no card
 * can follow the camera around the room.
 *
 * The starting offset is dithered per pixel. Without it, twenty-four fixed
 * steps lay down twenty-four visible rings around the window.
 */
const RAYS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 origin;
uniform float density;
uniform float decay;
uniform float weight;
varying vec2 vUv;

float noise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 step = (vUv - origin) * (density / float(SAMPLES));
  vec2 uv = vUv - step * noise(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  float fade = 1.0;
  for (int i = 0; i < SAMPLES; i++) {
    uv -= step;
    acc += texture2D(tSrc, uv).rgb * fade;
    fade *= decay;
  }
  gl_FragColor = vec4(acc * weight, 1.0);
}
`;


/**
 * Occlusion, traced across the depth buffer.
 *
 * The one pass here that fires rays rather than blurring something. For every
 * pixel it recovers where that pixel actually is in front of the camera,
 * scatters a dozen points through the hemisphere above it, and asks of each
 * whether the depth buffer says something is already standing there. How many
 * come back yes is how enclosed the point is. It is the same question the
 * lighting bake asks with real geometry — see `trace.ts` — asked again
 * against the image, which is far less accurate and has the one property the
 * bake cannot have: it is answered fresh every frame, so it applies to things
 * that have moved since the room was built.
 *
 * Which is exactly what it is for. The room's own shading stays baked, and
 * this is kept to a hand's breadth of range so that it adds the dark seam
 * under a mug that has just been put down and does not attempt to relight the
 * corners, where the traced version is already better.
 *
 * Normals are recovered from the depth buffer's own slope rather than from a
 * second pass that writes them. A depth prepass over a room of this many
 * meshes costs more than everything else in this file put together, to improve
 * an effect that is being deliberately held at a whisper.
 */
const AO = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform mat4 projection;
uniform mat4 unproject;
uniform vec3 kernel[AO_SAMPLES];
uniform vec2 texel;
uniform float radius;
uniform float bias;
varying vec2 vUv;

vec3 viewPosition(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 view = unproject * clip;
  return view.xyz / view.w;
}

/**
 * Which way the surface faces, recovered without trusting the derivative.
 *
 * The obvious spelling is a cross product of the two screen derivatives of
 * the position, and it is wrong here for
 * a reason that only shows up on exactly the surfaces this room is made of. A
 * depth buffer is quantised, and heavily non-linear: out where a wall four
 * metres away sits, one step of the buffer covers more distance than there is
 * between two neighbouring pixels of a plane seen nearly face-on. So the
 * difference between them rounds to *nothing*, the derivative comes out zero,
 * the cross product is degenerate, and the normalised result is whatever the
 * hardware makes of dividing by zero.
 *
 * A wrong normal points the sampling hemisphere into the wall instead of out
 * of it, every sample comes back occluded, and the pixel goes dark. And
 * because the rounding follows the buffer's own steps, the pixels it happens
 * to are the ones on a line of constant depth — which across a flat wall is a
 * straight line. That is the whole of the defect: neat dark bands ruled
 * across every large smooth surface in the room, and none at all on anything
 * small or busy enough for the derivative to have something to measure.
 *
 * So the slope is taken across two pixels rather than one, which puts the
 * difference back above the quantum, and from whichever side of the pixel
 * agrees better with it — the standard guard, and the one that also stops the
 * normal being taken across a silhouette edge, where the two sides belong to
 * different objects entirely.
 */
vec3 surfaceNormal(vec2 uv, vec3 here) {
  vec2 step = texel * 2.0;
  vec3 left  = viewPosition(uv - vec2(step.x, 0.0));
  vec3 right = viewPosition(uv + vec2(step.x, 0.0));
  vec3 down  = viewPosition(uv - vec2(0.0, step.y));
  vec3 up    = viewPosition(uv + vec2(0.0, step.y));

  vec3 dx = abs(left.z - here.z) < abs(right.z - here.z) ? here - left : right - here;
  vec3 dy = abs(down.z - here.z) < abs(up.z - here.z) ? here - down : up - here;

  vec3 n = cross(dx, dy);
  /* Still degenerate — the surface is edge-on, or the whole neighbourhood
     landed inside one quantum anyway. Facing the camera is the answer that
     does no harm: it puts the hemisphere in front of the surface, where a
     flat wall's samples find nothing, which is the correct result for a flat
     wall and a harmless one everywhere else. */
  float len = length(n);
  if (len < 1e-6) return vec3(0.0, 0.0, 1.0);
  n /= len;
  return n.z < 0.0 ? -n : n;
}

float noise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  // the far plane: sky, or nothing at all. Nothing there to shade.
  if (depth >= 0.9999) { gl_FragColor = vec4(1.0); return; }

  vec3 origin = viewPosition(vUv);
  vec3 normal = surfaceNormal(vUv, origin);

  /* A different rotation per pixel, so that twelve samples read as noise the
     blur can remove rather than as twelve banded steps it cannot. */
  float angle = noise(gl_FragCoord.xy) * 6.2831853;
  vec3 random = vec3(cos(angle), sin(angle), 0.0);
  vec3 tangent = normalize(random - normal * dot(random, normal));
  vec3 bitangent = cross(normal, tangent);
  mat3 basis = mat3(tangent, bitangent, normal);

  float occluded = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    vec3 at = origin + basis * kernel[i] * radius;
    vec4 projected = projection * vec4(at, 1.0);
    vec2 uv = (projected.xy / projected.w) * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

    float surface = viewPosition(uv).z;
    /*
     * The tolerance grows with distance, because the buffer's steps do. A
     * fixed one is generous close up, where the steps are fractions of a
     * millimetre, and far too mean at the back of a room, where a single step
     * is wider than the thing being tested for.
     */
    float slack = bias * (1.0 + abs(origin.z) * 0.0016);
    /*
     * Without this, anything in front of a distant background occludes the
     * whole background — a mug against a far wall would drag a dark halo
     * around itself, because the depth buffer says the wall is behind it and
     * says nothing about how far behind. Weighting by the gap confines the
     * effect to things that are actually near each other, which is the only
     * case where the depth buffer's answer means anything.
     */
    float within = smoothstep(0.0, 1.0, radius / max(1e-4, abs(origin.z - surface)));
    occluded += step(at.z + slack, surface) * within;
  }

  gl_FragColor = vec4(vec3(1.0 - occluded / float(AO_SAMPLES)), 1.0);
}
`;

/** Four taps in a cross, twice — the noise goes, the seam stays. */
const AO_BLUR = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 direction;
varying vec2 vUv;
void main() {
  float s = texture2D(tSrc, vUv).r * 0.375;
  s += texture2D(tSrc, vUv + direction).r * 0.25;
  s += texture2D(tSrc, vUv - direction).r * 0.25;
  s += texture2D(tSrc, vUv + direction * 2.4).r * 0.0625;
  s += texture2D(tSrc, vUv - direction * 2.4).r * 0.0625;
  gl_FragColor = vec4(vec3(s), 1.0);
}
`;

/**
 * The frame, assembled and graded.
 *
 * Order matters and is the whole of the physics on offer here. Spill and bands
 * are added in linear light, *before* the tone curve, because that is where
 * they happen — light landing on a sensor, not paint added to a photograph.
 * Adding them afterwards is the difference between a window that blows out and
 * a window with a grey wash over it, and it is instantly recognisable.
 *
 * The curve itself is ACES, copied rather than reinvented: it is the same
 * transform three.js was applying inside every material shader before this
 * file existed, so moving it here changes where the room is tone mapped and
 * not how it looks.
 *
 * Then the three small lies at the end, each of which is a property of a lens
 * and a sensor rather than of a room. A vignette, because no lens is evenly
 * bright to its corners. A whisper of colour fringing that grows with the
 * square of the distance from the centre, which is what a real one does. And
 * grain, weighted into the shadows where film actually shows it — which does
 * double duty, because an eight-bit screen cannot represent the gradient
 * across a plastered wall without banding it, and noise of about one code
 * value is precisely what breaks a band up.
 */
const COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform sampler2D tAo;
uniform vec3 rayTint;
uniform float exposure;
uniform float bloomAmount;
uniform float rayAmount;
uniform float vignette;
uniform float grain;
uniform float fringe;
uniform float aoAmount;
uniform float seed;
uniform float contrast;
uniform float saturation;
uniform float split;
uniform vec3 shadeTint;
uniform vec3 glowTint;
varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 aces(vec3 color) {
  const mat3 IN = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
  );
  const mat3 OUT = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602
  );
  color = IN * color;
  color = RRTAndODTFit(color);
  return clamp(OUT * color, 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

float noise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

/**
 * The grade: what a colourist does after the photograph exists.
 *
 * Deliberately after the tone curve rather than before it, because that is
 * where these three controls mean what they are named. Contrast pivots about
 * mid grey, and mid grey is only in a fixed place once the image is
 * display-referred; a split-tone works on which end of the range a pixel sits
 * at, and there is no range to sit in until something has decided where white
 * is. Applied in linear light these would be three ways of changing the
 * exposure.
 *
 * The split is most of the mood. Shadows in a real room are never a darker
 * version of the light — they are lit by a different light. Under a window
 * they are lit by the sky and go blue; in a concrete room at dusk they go
 * blue and slightly green. Pulling the dark end one way and the bright end
 * the other is the difference between a dim photograph and a photograph taken
 * somewhere at a particular hour, and it costs four multiplies.
 */
vec3 grade(vec3 color) {
  float luma = dot(color, LUMA);
  color = mix(vec3(luma), color, saturation);

  /*
   * Contrast on the brightness, not on the three channels.
   *
   * The obvious spelling — push each channel away from a half — is also a
   * saturation control, and a fierce one. A piece of oak sits at roughly
   * four parts red to one part blue; deepen every channel about the same
   * midpoint and it comes out at six to one, which is not a darker piece of
   * oak, it is a piece of mahogany. That is exactly what the worktop and the
   * letter racks did the first time this ran, and no amount of tuning the
   * tint below was ever going to fix it, because the tint was not what was
   * doing it.
   *
   * Scaling the whole colour by what the curve did to its brightness leaves
   * every ratio between the channels untouched, so the room gets deeper and
   * stays the colour it was built. Saturation is then a separate control that
   * means only what it says.
   */
  luma = dot(color, LUMA);
  float curved = clamp(mix(0.5, luma, contrast), 0.0, 1.0);
  color = clamp(color * (curved / max(luma, 1e-4)), 0.0, 1.0);

  luma = curved;
  vec3 toned = mix(color * shadeTint, color * glowTint, smoothstep(0.0, 0.92, luma));

  /*
   * Held back wherever the pixel already has a colour of its own.
   *
   * A split-tone is a multiply, and a multiply is a rotation of hue as much
   * as a shift of temperature — which is harmless on plaster and concrete,
   * where there is almost no hue to rotate, and ruinous on oak. The first
   * version of this graded the worktop from brown to crimson, because a
   * sixteen per cent lift on a channel that is already twice the other two
   * does not read as warmth, it reads as a different piece of wood.
   *
   * So the tone is scaled down by how much colour is there to begin with.
   * The neutrals — which is most of both rooms, and all of the part that
   * carries the mood — take it in full; anything the art direction has
   * already decided the colour of keeps it. It is the difference between a
   * grade you can push and a grade you cannot.
   */
  float top = max(color.r, max(color.g, color.b));
  float chroma = (top - min(color.r, min(color.g, color.b))) / max(top, 1e-4);
  return mix(color, toned, split * (1.0 - 0.75 * chroma));
}

void main() {
  vec2 off = vUv - 0.5;
  float r2 = dot(off, off);

  #ifdef FRINGE
    /* Sampled three times along the radius, so the split is zero dead centre
       and widest in the corners — the way a lens disperses, rather than a
       uniform smear over the whole frame. */
    vec2 shift = off * r2 * fringe;
    vec3 scene = vec3(
      texture2D(tScene, vUv + shift).r,
      texture2D(tScene, vUv).g,
      texture2D(tScene, vUv - shift).b
    );
  #else
    vec3 scene = texture2D(tScene, vUv).rgb;
  #endif

  #ifdef AO
    /* Applied to the room before anything is added to it, because occlusion
       is a property of the light arriving at a surface and the spill is not
       light arriving at anything — it is the lens. A corner that has been
       darkened should not then be given its brightness back by its own
       bloom. */
    scene *= 1.0 - (1.0 - texture2D(tAo, vUv).r) * aoAmount;
  #endif

  #ifdef BLOOM
    scene += texture2D(tBloom, vUv).rgb * bloomAmount;
  #endif
  #ifdef RAYS
    scene += texture2D(tRays, vUv).rgb * rayTint * rayAmount;
  #endif

  vec3 color = grade(aces(scene * (exposure / 0.6)));

  // 1.0 at the centre, falling away with the square of the radius
  color *= 1.0 - vignette * smoothstep(0.05, 0.78, r2);

  color = toSRGB(color);

  /* Triangular noise — two samples differenced — rather than uniform. It is
     the shape that leaves no bias behind at any code value, which is what
     lets an amplitude of about one part in 255 cancel banding without ever
     reading as dirt. */
  float n1 = noise(gl_FragCoord.xy + seed);
  float n2 = noise(gl_FragCoord.xy * 1.371 - seed);
  float shadowed = 1.0 - smoothstep(0.0, 0.85, dot(color, vec3(0.2126, 0.7152, 0.0722)));
  color += (n1 - n2) * (grain * (0.35 + 0.65 * shadowed) + 0.0022);

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Where to look, from a point on a surface.
 *
 * Points in the hemisphere above the normal, pulled in toward the centre so
 * that most of them land close to the surface and a few reach out. Occlusion
 * falls off with distance, so spreading samples evenly through the volume
 * spends most of them measuring the part that barely contributes; clustering
 * them near the origin puts the sampling where the answer actually changes.
 *
 * Fixed rather than random, because the same twelve directions everywhere
 * would band — which is what the per-pixel rotation in the shader is for. The
 * sequence only has to be well spread; it does not have to be different per
 * pixel, and generating it once means it is identical across frames and so
 * cannot flicker.
 */
function hemisphere(count: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    /* The golden angle again, as in the shadow filter: a spiral over the
       hemisphere with no two neighbours adjacent in the sequence. */
    const theta = i * 2.399963229728653;
    const z = (i + 0.5) / count;
    const r = Math.sqrt(1 - z * z);
    const v = new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r, z);
    // 0.35 at the first sample rising to 1 at the last, squared to bias inward
    const scale = 0.35 + 0.65 * ((i + 1) / count) ** 2;
    out.push(v.multiplyScalar(scale));
  }
  return out;
}

/* ------------------------------------------------------------------- rig */

/**
 * The look of a room, after everything else has finished being correct.
 *
 * Five numbers and two colours, applied at the very end of the composite. The
 * renderer's job up to that point is to be right about the light; this is the
 * separate and equally real job of deciding what the photograph of it should
 * feel like, and the two are kept apart because they change for completely
 * different reasons.
 */
export interface Grade {
  /** About mid grey. Above one deepens the shadows without moving white. */
  contrast: number;
  /** Below one bleeds the colour out; a dim room is never as colourful as a
   *  bright one, because the eye's own colour receptors need light. */
  saturation: number;
  /** How far the two tints below are taken. Zero is no grade at all. */
  split: number;
  /** What colour the dark end goes — whatever is lighting the shadows. */
  shade: number;
  /** And the bright end, which is whatever is lighting the room. */
  glow: number;
  /**
   * How far the corners fall away.
   *
   * Here rather than in the quality tiers, where it started, because it costs
   * one smoothstep and is therefore not a performance decision at all — and
   * because how much of it a room wants depends entirely on the room. A bright
   * kitchen can take a deep one and reads as intimate; a concrete room at dusk
   * given the same number simply loses its far corner, and a corner that is
   * gone is not moody, it is missing.
   */
  vignette: number;
}

export interface Post {
  /** Draw the scene through the chain, ending on the canvas. */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(): void;
  /**
   * Where the light comes into the room, in world space, and what colour it
   * is when it gets here. Null switches the bands off — a room with no window
   * in shot has nothing for them to come from.
   */
  setSource(at: THREE.Vector3Like | null, colour?: number): void;
  /**
   * How this room is graded. Art direction, not quality: a room looks the way
   * it looks on every machine that can draw it at all.
   */
  setGrade(grade: Grade): void;
  /**
   * Give up a whole pass, because the machine is struggling.
   *
   * Called from the frame-time ladder in `useRoomScene`, which hands out one
   * rung at a time and never takes one back. Two rungs live here, in the order
   * of what can be lost with the least noticed: the scattering, which is pure
   * atmosphere; then the occlusion, which is three whole-frame round trips for
   * a shading cue the traced bake has largely already made.
   *
   * Both are passes over the whole frame, which is why they are the first
   * thing the ladder asks for and why they are separate from `thin` below.
   * Returns whether there was anything left to give, so a machine that has
   * already spent a rung — or never had these passes to begin with, which is
   * every phone — falls straight through to the next rung rather than
   * spending one on nothing.
   */
  relieve(): boolean;
  /**
   * And the last thing here worth taking: most of the bloom pyramid.
   *
   * Separate from `relieve` because it is a different size of saving. The two
   * passes above are full-frame; these are the levels *below* the first one,
   * each a quarter of the one above it, and all four of them together come to
   * a third of the first level alone. Giving them up leaves a tighter spill
   * rather than none, and on a phone — where the pyramid starts a step lower
   * still — it is close to free either way.
   *
   * Which is exactly why it must not be spent early. It used to be the third
   * rung inside `relieve`, and on a handheld, where there is no scattering and
   * no occlusion to shed, it was therefore the *first* rung the ladder reached
   * — two thirds of a second of visible stutter traded for a saving too small
   * to measure, while the thing actually costing the frame went untouched for
   * another two thirds of a second. It now comes after the shadows, which is
   * where a saving this size belongs.
   *
   * What is never given up is the tone curve, the grade and the first level of
   * spill. Those are not effects layered on the room, they are how the room is
   * drawn, and a machine that dropped them would not look economical — it
   * would look broken.
   */
  thin(): boolean;
  /** False on the bottom tier, where `render` is a plain render. */
  readonly active: boolean;
  dispose(): void;
}

function target(width: number, height: number, type: THREE.TextureDataType, samples = 0) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  t.texture.colorSpace = THREE.LinearSRGBColorSpace;
  t.samples = samples;
  return t;
}

export function createPost(renderer: THREE.WebGLRenderer): Post {
  const q = quality();

  /*
   * Whether there is a floating-point buffer to render into at all.
   *
   * Without one the whole thing is pointless: an eight-bit buffer clips every
   * highlight at white before the prefilter can see how bright it really was,
   * and a bloom measured off clipped values is a bloom of uniform strength
   * around everything pale.
   *
   * Asked of the extensions rather than of `capabilities.isWebGL2`, which
   * three.js now hard-codes to true and keeps only for the sake of code that
   * used to check it. Rendering *into* a half-float texture is a separate
   * permission from sampling one, it is the permission this needs, and a
   * driver without it falls back to no post at all rather than to a bad one.
   */
  const floating =
    renderer.extensions.has('EXT_color_buffer_half_float') ||
    renderer.extensions.has('EXT_color_buffer_float');

  if (!q.post || !floating) {
    return {
      active: false,
      render: (scene, camera) => {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      },
      setSize: () => {},
      setSource: () => {},
      setGrade: () => {},
      relieve: () => false,
      thin: () => false,
      dispose: () => {},
    };
  }

  /*
   * The tone curve moves out of the materials and into the composite, once,
   * here. It cannot be toggled per frame: `toneMapping` is compiled into every
   * shader program in the scene, and changing it recompiles all of them.
   *
   * Exposure stays where it was. The rooms each set `toneMappingExposure` when
   * they come in, and reading it back from the renderer means that continues
   * to work untouched — one number, one owner, still spelled the same way.
   */
  renderer.toneMapping = THREE.NoToneMapping;

  const blit = new Blit(renderer);
  const size = new THREE.Vector2();
  const HDR = THREE.HalfFloatType;

  /** The room itself, with room above white. Depth, because the room needs it. */
  const hdr = new THREE.WebGLRenderTarget(1, 1, {
    type: HDR,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
  /*
   * Multisampling moved here with the scene.
   *
   * `antialias` on the context only ever applied to the canvas, and the canvas
   * is no longer what the room is drawn into — so asking for it there would
   * pay for a multisampled drawing buffer that only ever receives one
   * full-screen triangle with no interior edges in it. The samples belong on
   * this target instead, which is the surface that actually has geometry
   * edges on it.
   */
  hdr.samples = q.samples;
  if (q.ao) {
    /*
     * Depth, kept rather than discarded.
     *
     * The room needs a depth buffer either way; asking for it as a texture
     * rather than a renderbuffer means the occlusion pass can read back the
     * one the room has already filled in, instead of anything being drawn a
     * second time. Twenty-four bits over a near-to-far ratio of a hundred and
     * fifty is more than enough to tell a mug from the worktop under it.
     */
    hdr.depthTexture = new THREE.DepthTexture(1, 1);
    hdr.depthTexture.format = THREE.DepthFormat;
    hdr.depthTexture.type = THREE.UnsignedIntType;
  }

  const mips: THREE.WebGLRenderTarget[] = [];
  /** How many of them are currently in use; the ladder can lower this. */
  let levels = 0;
  /** Two, because a separable blur has to land somewhere on the way through. */
  let ao: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  let rays: THREE.WebGLRenderTarget | null = null;

  const prefilter = pass(PREFILTER, {
    tSrc: { value: null },
    texel: { value: new THREE.Vector2() },
    threshold: { value: q.bloomThreshold },
    knee: { value: 0.55 },
    ceiling: { value: 14 },
  });
  const down = pass(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  const up = pass(UP, {
    tSrc: { value: null },
    texel: { value: new THREE.Vector2() },
    radius: { value: 1 },
  });
  up.blending = THREE.AdditiveBlending;

  const rayPass = q.scatter
    ? pass(
        RAYS,
        {
          tSrc: { value: null },
          origin: { value: new THREE.Vector2(0.5, 0.5) },
          density: { value: 0.72 },
          decay: { value: 0.95 },
          weight: { value: 0.42 / q.scatterSamples },
        },
        { SAMPLES: q.scatterSamples },
      )
    : null;

  const aoPass = q.ao
    ? pass(
        AO,
        {
          tDepth: { value: null },
          projection: { value: new THREE.Matrix4() },
          unproject: { value: new THREE.Matrix4() },
          kernel: { value: hemisphere(q.aoSamples) },
          texel: { value: new THREE.Vector2() },
          /* A hand's breadth, in the units these rooms are drawn at — three
             thousand to the metre. Long enough to find the worktop under a
             mug, short enough never to reach the wall behind it. */
          radius: { value: 430 },
          /* Depth is not flat, and a surface sampled against itself at a
             glancing angle will read as occluding itself all over. The bias
             is the slope this tolerates before believing it. */
          bias: { value: 14 },
        },
        { AO_SAMPLES: q.aoSamples },
      )
    : null;
  const aoBlur = q.ao
    ? pass(AO_BLUR, { tSrc: { value: null }, direction: { value: new THREE.Vector2() } })
    : null;

  const composite = pass(
    COMPOSITE,
    {
      tScene: { value: null },
      tBloom: { value: null },
      tRays: { value: null },
      tAo: { value: null },
      rayTint: { value: new THREE.Color(1, 0.93, 0.82) },
      exposure: { value: 1 },
      bloomAmount: { value: q.bloomStrength },
      rayAmount: { value: 0 },
      vignette: { value: 0 },
      grain: { value: q.grain },
      fringe: { value: q.fringe },
      aoAmount: { value: q.aoStrength },
      seed: { value: 0 },
      contrast: { value: 1 },
      saturation: { value: 1 },
      split: { value: 0 },
      shadeTint: { value: new THREE.Vector3(1, 1, 1) },
      glowTint: { value: new THREE.Vector3(1, 1, 1) },
    },
    {
      BLOOM: 1,
      ...(q.ao ? { AO: 1 } : {}),
      ...(q.scatter ? { RAYS: 1 } : {}),
      ...(q.fringe > 0 ? { FRINGE: 1 } : {}),
    },
  );

  /**
   * How many rungs of `relieve` have been spent. One-way: reallocating these
   * buffers costs more than a struggling machine ever gets back from changing
   * its mind, which is the same reasoning the resolution ladder uses.
   */
  let shed = 0;

  /* Where the light comes in. How strongly it scatters is worked out per
     frame, because it depends entirely on whether it is in shot. */
  let source: THREE.Vector3 | null = null;
  const projected = new THREE.Vector3();

  const setSize = () => {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, size.x);
    const h = Math.max(2, size.y);
    if (hdr.width === w && hdr.height === h) return;
    /*
     * The depth texture is resized by hand, because `setSize` does not do it.
     * It walks the colour attachments only, and three.js then refuses — by
     * throwing, in the middle of a frame — to bind a depth texture whose
     * dimensions disagree with the target it is attached to. Two lines here
     * or an exception on the first window resize.
     */
    if (hdr.depthTexture) {
      hdr.depthTexture.image.width = w;
      hdr.depthTexture.image.height = h;
      hdr.depthTexture.dispose();
    }
    hdr.setSize(w, h);

    mips.forEach((m) => m.dispose());
    mips.length = 0;
    /*
     * How many levels to build.
     *
     * Each one is half the edge of the last, so level n blurs across 2^n
     * pixels of the original — six levels on a tall window is a spill sixty-
     * odd pixels wide, which is about the widest that still reads as light
     * rather than as fog. The chain stops early on a small viewport rather
     * than grinding down to a four-pixel buffer whose contents are one flat
     * colour.
     */
    levels = Math.max(2, Math.min(q.bloomLevels, Math.floor(Math.log2(Math.min(w, h))) - 3 - q.bloomStart));
    if (shed >= 3) levels = 2;
    for (let i = 0; i < levels; i++) {
      const step = i + 1 + q.bloomStart;
      mips.push(target(Math.max(2, w >> step), Math.max(2, h >> step), HDR));
    }

    rays?.dispose();
    // `shed` is one-way: a resize must not hand back what the ladder took
    rays = q.scatter && shed < 1 ? target(Math.max(2, w >> 2), Math.max(2, h >> 2), HDR) : null;

    ao?.forEach((t) => t.dispose());
    ao = null;
    if (q.ao && shed < 2) {
      /* Half resolution and eight bits. Occlusion is a single low-frequency
         channel that is about to be blurred twice; there is nothing in it
         that a quarter of the memory cannot hold. */
      const aw = Math.max(2, w >> 1);
      const ah = Math.max(2, h >> 1);
      ao = [target(aw, ah, THREE.UnsignedByteType), target(aw, ah, THREE.UnsignedByteType)];
      (aoPass!.uniforms.texel.value as THREE.Vector2).set(1 / aw, 1 / ah);
    }

  };
  setSize();

  const setGrade = (grade: Grade) => {
    const u = composite.uniforms;
    u.contrast.value = grade.contrast;
    u.saturation.value = grade.saturation;
    u.split.value = grade.split;
    u.vignette.value = grade.vignette;
    /*
     * Left in sRGB rather than converted to linear, because by the point
     * these are used the image is in sRGB too — the grade runs after the tone
     * curve, where a multiply of 1.06 means six per cent brighter *as seen*
     * rather than six per cent more light. Converting would make the same
     * number mean something different at each end of the range, which is
     * exactly what a colourist does not want from a tint.
     */
    (u.shadeTint.value as THREE.Vector3).set(
      ((grade.shade >> 16) & 255) / 128,
      ((grade.shade >> 8) & 255) / 128,
      (grade.shade & 255) / 128,
    );
    (u.glowTint.value as THREE.Vector3).set(
      ((grade.glow >> 16) & 255) / 128,
      ((grade.glow >> 8) & 255) / 128,
      (grade.glow & 255) / 128,
    );
  };

  const setSource = (at: THREE.Vector3Like | null, colour?: number) => {
    source = at ? new THREE.Vector3(at.x, at.y, at.z) : null;
    if (colour !== undefined) composite.uniforms.rayTint.value.setHex(colour).convertSRGBToLinear();
  };

  /**
   * Where the window is on screen, and whether to bother.
   *
   * The bands are only meaningful while their source is somewhere in or near
   * the frame. Behind the camera they would march the wrong way; far outside
   * it they are a smear with no visible cause. So the strength is faded out
   * over the last part of the way off screen rather than switched off at the
   * edge, which would be a visible step exactly when the camera is moving.
   */
  const aimRays = (camera: THREE.Camera) => {
    if (!rayPass || !source) return 0;
    projected.copy(source).project(camera);
    if (projected.z > 1) return 0;
    const u = projected.x * 0.5 + 0.5;
    const v = projected.y * 0.5 + 0.5;
    (rayPass.uniforms.origin.value as THREE.Vector2).set(u, v);
    const outside = Math.max(0, Math.abs(u - 0.5) - 0.5, Math.abs(v - 0.5) - 0.5);
    return Math.max(0, 1 - outside / 0.45);
  };

  return {
    active: true,
    setSize,
    setSource,
    setGrade,

    relieve() {
      if (shed < 1) {
        shed = 1;
        if (rayPass) {
          rays?.dispose();
          rays = null;
          return true;
        }
      }
      if (shed < 2) {
        shed = 2;
        if (aoPass) {
          ao?.forEach((t) => t.dispose());
          ao = null;
          /* The composite still has `AO` compiled into it and still samples
             the texture — recompiling it here would cost a stall at exactly
             the wrong moment. Zeroing the amount makes that sample a no-op
             and the three passes that filled it stop running, which is where
             all of the cost was. */
          composite.uniforms.aoAmount.value = 0;
          return true;
        }
      }
      return false;
    },

    thin() {
      if (shed >= 3) return false;
      shed = 3;
      if (mips.length <= 2) return false;
      /* Kept rather than disposed: the levels stop being written and stop
         being read, and a buffer nobody touches costs only the memory it is
         already holding. Freeing them would mean rebuilding the whole chain on
         the next resize for no gain. */
      levels = 2;
      return true;
    },

    render(scene, camera) {
      setSize();

      /* The room, into floating point. Everything after this is image. */
      renderer.setRenderTarget(hdr);
      renderer.render(scene, camera);

      /*
       * Occlusion first, because the composite multiplies the room by it and
       * the bloom is added after that. It reads the depth the room has just
       * written and nothing else — no geometry is touched twice.
       */
      if (aoPass && aoBlur && ao && shed < 2) {
        aoPass.uniforms.tDepth.value = hdr.depthTexture;
        (aoPass.uniforms.projection.value as THREE.Matrix4).copy(camera.projectionMatrix);
        (aoPass.uniforms.unproject.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        blit.to(ao[0], aoPass);
        // separable: across, then down, for a fifth of the taps of one square pass
        aoBlur.uniforms.tSrc.value = ao[0].texture;
        (aoBlur.uniforms.direction.value as THREE.Vector2).set(1 / ao[0].width, 0);
        blit.to(ao[1], aoBlur);
        aoBlur.uniforms.tSrc.value = ao[1].texture;
        (aoBlur.uniforms.direction.value as THREE.Vector2).set(0, 1 / ao[0].height);
        blit.to(ao[0], aoBlur);
      }

      prefilter.uniforms.tSrc.value = hdr.texture;
      (prefilter.uniforms.texel.value as THREE.Vector2).set(
        (1 << q.bloomStart) / hdr.width,
        (1 << q.bloomStart) / hdr.height,
      );
      blit.to(mips[0], prefilter);

      for (let i = 1; i < levels; i++) {
        const src = mips[i - 1];
        down.uniforms.tSrc.value = src.texture;
        (down.uniforms.texel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        blit.to(mips[i], down);
      }

      /* The bands are read off a middle level: fine enough to still have the
         mullions in it, coarse enough that two dozen taps cover the distance
         from the window to the far side of the frame. */
      let rayStrength = 0;
      if (rayPass && rays && shed < 1) {
        rayStrength = aimRays(camera);
        if (rayStrength > 0.001) {
          rayPass.uniforms.tSrc.value = mips[Math.min(1, levels - 1)].texture;
          blit.to(rays, rayPass);
        }
      }

      for (let i = levels - 1; i > 0; i--) {
        const src = mips[i];
        up.uniforms.tSrc.value = src.texture;
        (up.uniforms.texel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        // added onto the level below, never cleared: the sum is the point
        blit.to(mips[i - 1], up, false);
      }

      composite.uniforms.tScene.value = hdr.texture;
      composite.uniforms.tBloom.value = mips[0].texture;
      composite.uniforms.tRays.value = rays ? rays.texture : null;
      composite.uniforms.tAo.value = ao ? ao[0].texture : null;
      composite.uniforms.rayAmount.value = rayStrength * q.scatterStrength;
      composite.uniforms.exposure.value = renderer.toneMappingExposure;
      /* Re-seeded per frame so the grain moves. A fixed pattern over a still
         room is not grain, it is a dirty lens. */
      composite.uniforms.seed.value = (composite.uniforms.seed.value + 17.13) % 1024;
      blit.to(null, composite);
    },

    dispose() {
      hdr.dispose();
      mips.forEach((m) => m.dispose());
      rays?.dispose();
      ao?.forEach((t) => t.dispose());
      aoPass?.dispose();
      aoBlur?.dispose();
      prefilter.dispose();
      down.dispose();
      up.dispose();
      rayPass?.dispose();
      composite.dispose();
      blit.dispose();
    },
  };
}
