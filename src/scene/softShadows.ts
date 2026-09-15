import * as THREE from 'three';
import { quality } from './quality';

/**
 * Shadows that harden where they touch.
 *
 * A shadow map gives every light one answer per texel — in shadow or not — and
 * every filter built on top of it spreads that answer over a fixed radius.
 * Which means a shadow is equally soft everywhere: as soft where a mug meets
 * the worktop as it is two metres away on the floor. Real shadows do the
 * opposite of that, and it is the single most recognisable thing about them.
 * The dark line where an object touches a surface is knife-sharp; the same
 * shadow a metre away has spread into something with no edge at all.
 *
 * The reason is geometry. A light has a size — a window is a metre across, a
 * pendant shade is twenty centimetres — so the penumbra at any point is the
 * size of the light as seen from there, scaled by how far the blocker is in
 * front of the surface. Touch the surface and the blocker is zero distance
 * away and the penumbra collapses to nothing. That ratio is the whole of it,
 * and it is measurable from the shadow map itself.
 *
 * So this is done in two passes per pixel. First a wide search for what is
 * blocking the light and how far in front it is, then a filter whose radius is
 * that answer. It is the standard construction — percentage-closer soft
 * shadows — and it is the closest a rasteriser comes to what a ray tracer gets
 * for nothing, because a traced shadow ray aimed anywhere on a light of real
 * size produces exactly this and produces it without being asked.
 *
 * Two things make it affordable here. The shadow maps are drawn once and kept
 * — the rooms do not move — so nothing in the first pass is being paid for
 * repeatedly. And the room is drawn on demand, so a still camera pays for none
 * of it at all.
 */

/**
 * Whether the filter runs at all for a given light, and how wide it may go.
 *
 * Expressed as the light's own `shadow.radius`, read as its size in shadow-map
 * texels rather than as a fixed blur — the cap on how wide the penumbra is
 * ever allowed to get, rather than how wide it always is. Zero switches the
 * two passes off entirely and leaves that light on the cheap single tap,
 * which is how a light opts out of paying for something nobody would see.
 */
const PCSS = /* glsl */ `

/*
 * Depth, pointing the same way whichever way the buffer runs.
 *
 * A reversed depth buffer — which three.js will use where it can, for the
 * precision it buys near the camera — puts one at the near plane and zero at
 * the far one. Every comparison below is "is this blocker nearer the light
 * than the surface", and writing that twice for the two conventions is how
 * one of them ends up wrong. Normalised once here instead, so that larger is
 * always further from the light.
 */
#ifdef USE_REVERSED_DEPTH_BUFFER
  #define SHADOW_AWAY( d ) ( 1.0 - ( d ) )
#else
  #define SHADOW_AWAY( d ) ( d )
#endif

float pcssNoise( vec2 position ) {
  return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
}

vec2 pcssDisk( int index, int count, float phi ) {
  const float goldenAngle = 2.399963229728653;
  float r = sqrt( ( float( index ) + 0.5 ) / float( count ) );
  float theta = float( index ) * goldenAngle + phi;
  return vec2( cos( theta ), sin( theta ) ) * r;
}

float pcssShadow( sampler2D shadowMap, vec4 shadowCoord, float lightSize, vec2 shadowMapSize ) {

  float receiver = SHADOW_AWAY( shadowCoord.z );
  vec2 texel = vec2( 1.0 ) / shadowMapSize;

  /*
   * How the surface itself is tilted, in the shadow map's own space.
   *
   * This is the price of a filter that is allowed to be wide, and there is no
   * way round paying it. Every tap asks "is the thing recorded here nearer the
   * light than I am", and a tap fifty texels away lands on a part of the same
   * surface that is genuinely nearer — a worktop running away from the light
   * is nearer along its whole length. With one fixed bias for the whole
   * filter, every sloped surface in the room reports itself in shadow in a
   * fine speckle, which is precisely what happened the first time this ran.
   *
   * So the surface's own depth slope is recovered from the derivatives of the
   * shadow coordinate — two screen-space differences, solved for how depth
   * changes per unit of shadow-map travel — and each tap is compared against
   * where the surface would be at *that* tap rather than where it is here. A
   * flat wall gets a gradient of nothing and is unaffected; a worktop seen
   * end-on gets exactly the compensation it needs.
   *
   * The cap is for surfaces so close to edge-on that the gradient is
   * effectively infinite. There the bias would swallow real shadows whole, and
   * a little acne on a surface you are looking along the length of is the
   * lesser of the two.
   */
  vec2 ddx = dFdx( shadowCoord.xy );
  vec2 ddy = dFdy( shadowCoord.xy );
  float det = ddx.x * ddy.y - ddy.x * ddx.y;
  vec2 slope = vec2( 0.0 );
  if ( abs( det ) > 1e-12 ) {
    float dzx = dFdx( receiver );
    float dzy = dFdy( receiver );
    slope = vec2( ddy.y * dzx - ddx.y * dzy, ddx.x * dzy - ddy.x * dzx ) / det;
  }

  /* A different rotation of the disc per pixel. Without it, a dozen fixed
     directions draw a dozen fixed spokes around every shadow edge in the
     room, and spokes are far more visible than the noise that replaces
     them. */
  float phi = pcssNoise( gl_FragCoord.xy ) * PI2;
  float search = lightSize * texel.x;

  /* -- 1. what is in the way, and how far in front of the surface ------- */
  float sum = 0.0;
  float found = 0.0;
  for ( int i = 0; i < PCSS_BLOCKER_SAMPLES; i ++ ) {
    vec2 offset = pcssDisk( i, PCSS_BLOCKER_SAMPLES, phi ) * search;
    float depth = SHADOW_AWAY( texture2D( shadowMap, shadowCoord.xy + offset ).r );
    float here = receiver + clamp( dot( offset, slope ), -PCSS_SLOPE_CAP, PCSS_SLOPE_CAP );
    if ( depth < here ) {
      sum += depth;
      found += 1.0;
    }
  }
  // nothing between here and the light: full sun, and no second pass
  if ( found < 0.5 ) return 1.0;
  /*
   * And the other end of the same argument, which is where the room actually
   * spends its time.
   *
   * If every tap of the search found something in the way, this pixel is
   * inside the umbra rather than on the edge of it. The filter below can only
   * ever sample a disc no wider than the search was — that is what the clamp
   * two lines down guarantees — so it would be sampling a subset of a region
   * the first pass has just reported as blocked from end to end, and it would
   * come back at nothing lit. There is no answer in it that is not already
   * here.
   *
   * This is worth far more than the full-sun case above it. A room is mostly
   * not in direct sun: the far side of the kitchen, the whole of the studio
   * away from the two pendants, the underside of every worktop. All of it was
   * paying for a second pass to be told what the first pass already knew.
   * What is left paying full price is the penumbra itself — the band where
   * the taps disagree — which is a few pixels wide and is the only place any
   * of this was ever visible.
   */
  if ( found > float( PCSS_BLOCKER_SAMPLES ) - 0.5 ) return 0.0;

  /* -- 2. the filter that implies ---------------------------------------- */
  float blocker = sum / found;
  /*
   * Similar triangles: the penumbra is the light's own width scaled by how
   * far the blocker stands in front of the surface, relative to how far it is
   * from the light. Touching means the numerator is zero and the edge is a
   * knife; further away it widens until it is the light's whole width and
   * there is no edge left at all.
   *
   * The depths are the shadow map's own, which are a shifted and scaled
   * version of distance from the light rather than distance itself, so the
   * ratio is proportional to the real one and not equal to it. That matters
   * less than it sounds: both ends of the range are exactly right — zero gap
   * still gives zero penumbra, and a large gap still saturates at the light's
   * width — and everything in between is a curve that is tuned by eye
   * anyway, through the width each light is given below.
   */
  float spread = ( receiver - blocker ) / max( blocker, 1e-5 );
  float radius = clamp( spread * search, texel.x * 0.6, search );

  float lit = 0.0;
  for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
    vec2 offset = pcssDisk( i, PCSS_SAMPLES, phi + 1.1 ) * radius;
    float depth = SHADOW_AWAY( texture2D( shadowMap, shadowCoord.xy + offset ).r );
    float here = receiver + clamp( dot( offset, slope ), -PCSS_SLOPE_CAP, PCSS_SLOPE_CAP );
    lit += step( here, depth );
  }
  return lit / float( PCSS_SAMPLES );

}
`;

/** What the single tap in the basic branch is replaced with. */
const CALL = /* glsl */ `
				/*
				 * Zero means a light that has opted out. The branch is on a
				 * uniform rather than on anything the pixel knows, so every
				 * pixel lit by a given light takes the same side of it and no
				 * warp is ever split between the two.
				 */
				if ( shadowRadius > 0.0 ) {

					shadow = pcssShadow( shadowMap, shadowCoord, shadowRadius, shadowMapSize );

				} else {

					float depth = texture2D( shadowMap, shadowCoord.xy ).r;

					#ifdef USE_REVERSED_DEPTH_BUFFER

						shadow = step( depth, shadowCoord.z );

					#else

						shadow = step( shadowCoord.z, depth );

					#endif

				}
`;

/**
 * The single tap this replaces, matched loosely on purpose.
 *
 * Loosely, because the copy of three.js that actually runs is not the copy
 * that is checked in. The shader chunks are authored as readable GLSL with
 * blank lines between the branches and shipped with those blank lines taken
 * out, so a patch written against the readable version — which is the version
 * a person reads while writing the patch — matches nothing at all in the
 * bundle, falls quietly through to the warning below, and leaves the whole of
 * this file compiled, shipped and never once executed. It did exactly that
 * for a while.
 *
 * So the anchor is the six statements in order, with any amount of anything
 * between them. That survives reformatting, survives the build's whitespace
 * stripping, and still cannot match anywhere else: it is the only place in
 * three.js that reads a shadow map with `texture2D` and compares it with
 * `step` twice.
 */
const PLAIN = new RegExp(
  [
    String.raw`float depth = texture2D\( shadowMap, shadowCoord\.xy \)\.r;`,
    String.raw`#ifdef USE_REVERSED_DEPTH_BUFFER`,
    String.raw`shadow = step\( depth, shadowCoord\.z \);`,
    String.raw`#else`,
    String.raw`shadow = step\( shadowCoord\.z, depth \);`,
    String.raw`#endif`,
  ].join(String.raw`\s*`),
);

let installed = false;

/**
 * Patch the shadow chunk, once, and say which shadow map type to use.
 *
 * `SHADOWMAP_TYPE_BASIC` rather than PCF, and that is not a downgrade — it is
 * the only branch of three.js's shadow code that binds the map as an ordinary
 * texture. The PCF branch binds it as `sampler2DShadow`, a comparison sampler
 * that can answer "is this in shadow" and cannot answer "how far away is the
 * thing blocking it", which is the only question the first pass above asks. So
 * the basic branch is the one with the information in it, and everything the
 * PCF branch was doing is done here instead, better.
 *
 * Returns the tier's own type untouched when soft shadows are off, so the
 * bottom tier keeps three.js's five-tap filter and none of this compiles.
 */
export function installSoftShadows(): THREE.ShadowMapType {
  const q = quality();
  if (!q.softShadows) return q.shadowType;
  if (installed) return THREE.BasicShadowMap;
  installed = true;

  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;

  /*
   * Already done, by a copy of this module that no longer exists.
   *
   * `installed` is module state and `THREE.ShaderChunk` is not: a hot reload
   * replaces this file's variables and leaves the patched chunk exactly where
   * it was. Worse, the patch is not self-excluding — the cheap branch it
   * writes contains the same six statements the anchor matches, because that
   * branch *is* the original single tap — so a second run finds its own
   * output, patches that, and leaves the shader with two copies of every
   * function in it. Three runs, three copies, and a room that compiles
   * nothing.
   *
   * So the real guard is the chunk itself rather than anything remembered
   * about it, which is also the only guard that can be right after a reload.
   */
  if (chunk.includes('pcssShadow')) return THREE.BasicShadowMap;

  if (!PLAIN.test(chunk)) {
    /*
     * three.js has been upgraded and moved the text this patch is anchored
     * to. Falling back to the stock filter is the right failure: soft shadows
     * are worth having and are not worth a room that renders black.
     */
    console.warn('Cork: three.js shadow chunk has changed shape; keeping the stock filter.');
    installed = false;
    return q.shadowType;
  }

  THREE.ShaderChunk.shadowmap_pars_fragment = chunk
    .replace('#ifdef USE_SHADOWMAP', `#ifdef USE_SHADOWMAP\n${PCSS}`)
    .replace(PLAIN, CALL);

  /* Sample counts are defines rather than uniforms so the loops unroll, which
     on this hardware is the difference between a filter and a stall. */
  THREE.ShaderChunk.common =
    `#define PCSS_BLOCKER_SAMPLES ${q.blockerSamples}\n` +
    `#define PCSS_SAMPLES ${q.shadowSamples}\n` +
    /*
     * The most the slope correction may move a comparison, as a fraction of
     * the shadow camera's whole depth range.
     *
     * Sized from the geometry rather than guessed. A tap out at the edge of
     * the search disc lands, on a surface tilted away from the light, at a
     * depth the surface's own slope predicts: the width of the search times
     * the tangent of the tilt. At sixty degrees — about as oblique as a
     * surface can be and still be lit enough for anything to show on it —
     * that comes to roughly one and a half per cent of the range in both
     * rooms and in the street outside them.
     *
     * It started four times tighter, which was enough for a worktop and not
     * nearly enough for a pavement thirty-five metres long: every tap past
     * the cap under-compensated, and the whole ground came out ruled with
     * fine dark lines along the shadow map's own texel grid.
     */
    '#define PCSS_SLOPE_CAP 0.018\n' +
    THREE.ShaderChunk.common;

  return THREE.BasicShadowMap;
}

/**
 * How big the light actually is, in the units the filter wants it in.
 *
 * `shadow.radius` is read here as the light's width measured in shadow-map
 * texels, which is a number that depends on the map's resolution and on how
 * much of the room its camera covers — both of which change with the tier. So
 * it is stated in world units at the call site, where a person can reason
 * about it (a window is about a metre and a half; these rooms are drawn at
 * three thousand units to the metre) and converted here.
 *
 * Without the conversion, a light tuned on the top tier would be half as soft
 * on the one below it purely because the map got smaller, which is the one
 * thing a quality setting must never do: change what the room looks like
 * rather than how well it is drawn.
 */
export function lightWidth(shadow: THREE.DirectionalLightShadow, world: number) {
  if (!quality().softShadows) {
    /*
     * Off, but not nothing.
     *
     * Where the two passes are not affordable the same property means
     * something else: three.js's own PCF filter reads it as how far apart to
     * spread nine fixed taps, and the default of one spreads them over a
     * single texel — which on a 1280-map across a room eight metres wide is a
     * shadow edge with the map's own staircase still in it.
     *
     * Three takes the staircase off and nothing else. It is the same number
     * the studio's pendants already fall back to, it costs not one extra tap
     * — the nine are taken either way — and it is small on purpose: the point
     * here is a clean edge, not an imitation of a penumbra. Pretending to be
     * soft with a fixed radius is what this whole file exists to stop doing.
     */
    shadow.radius = 3;
    return;
  }
  const texel = (shadow.camera.right - shadow.camera.left) / shadow.mapSize.x;
  shadow.radius = Math.max(1, world / texel);
}
