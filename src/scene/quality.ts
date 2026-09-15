import { useSyncExternalStore } from 'react';
import * as THREE from 'three';

/**
 * How much room to spend.
 *
 * Everything expensive in here — the shadow maps, the texture sizes, the
 * number of rays the lighting bake fires, whether there are light shafts at
 * all — is a number rather than a decision made at the point of use, and all
 * of those numbers come from one of three tiers. The scene asks once, at
 * build time, and never again: there is no per-frame branch on quality
 * anywhere, because a room that is drawn on demand cannot afford to decide
 * anything sixty times a second.
 *
 * The tier is guessed from the machine and can be overridden by the reader,
 * because guessing is what it is. A phone that turns out to be fast is one
 * tap from High, and a laptop that turns out to be throttled is one tap from
 * Low.
 */

export type Tier = 'low' | 'medium' | 'high';
export type GraphicsPref = 'auto' | Tier;

export interface Settings {
  tier: Tier;
  /** True when the tier was detected rather than chosen. */
  auto: boolean;

  /* -- the renderer, all of which is fixed at construction ------------- */
  antialias: boolean;
  powerPreference: WebGLPowerPreference;
  /** Ceiling on device pixel ratio, before the area ceiling below. */
  maxPixelRatio: number;
  /** Hard ceiling on the drawing buffer. A 4K panel on a weak GPU is the
   *  case this exists for: pixels cost more than anything else here. */
  maxPixels: number;
  /**
   * The filter three.js uses, where it is still doing the filtering.
   *
   * Only where `softShadows` is off. On the tiers where it is on, the map is
   * bound as a plain texture instead and everything is filtered in
   * `softShadows.ts`, which needs to read depths rather than compare them.
   */
  shadowType: THREE.ShadowMapType;
  /**
   * Whether shadows are allowed to work out their own softness.
   *
   * Two passes per shadowed pixel per light rather than one — see
   * `softShadows.ts`. It replaces three.js's fixed-radius filter with one
   * whose radius is measured from how far the blocker is in front of the
   * surface, which is the difference between a shadow that is uniformly
   * fuzzy and one that is sharp at the contact and gone a metre away.
   *
   * The shadow maps themselves are drawn once and kept, so none of the cost
   * is in producing them; all of it is in the fragment shader, which is
   * exactly the cost a tier is for.
   */
  softShadows: boolean;
  /** Taps in the search for what is casting, and then in the filter itself. */
  blockerSamples: number;
  shadowSamples: number;
  sunShadow: number;
  spotShadow: number;
  /** Whether the studio's pendants cast at all, or only the daylight does. */
  spotShadows: boolean;
  /**
   * How many of a room's small fill lights it may add.
   *
   * Not the key, and not the ambient — the little ones that only finish what
   * something larger has already started: the pair standing in the studio's
   * doorway so that the corridor beyond reads as a place rather than as a
   * grey rectangle. Each of them is another punctual light evaluated at every
   * lit pixel in the room, whether or not any of its light reaches that pixel,
   * because that is how a forward renderer works: the loop is over all of
   * them, everywhere. Measured, the studio's three came to about a fifth of
   * the cost of drawing it.
   *
   * So on a machine that is counting, the room keeps the ones that are doing
   * the most and gives up the ones that are refining. A room lists them in
   * that order and stops when it runs out of budget.
   */
  fills: number;

  /* -- textures -------------------------------------------------------- */
  /** How many times to halve every baked texture. */
  texSteps: number;
  anisotropy: number;
  /** Roughness maps are a third texture per surface for a second-order cue. */
  roughnessMaps: boolean;

  /* -- the lighting bake ----------------------------------------------- */
  /** Total rays for a room, shared out over however many vertices it has. */
  rayBudget: number;
  /** How finely a large flat surface is divided, so baked light has
   *  somewhere to live. */
  maxSegments: number;
  /** Edge of the cubemap the room is captured into, for reflections. */
  probe: number;

  /* -- the frame, after the room is in it ------------------------------ */
  /** Whether there is a post chain at all — see `post.ts`. */
  post: boolean;
  /** Multisamples on the HDR target, since the canvas no longer has any. */
  samples: number;
  /** Levels in the bloom pyramid; each one doubles how far the spill reaches. */
  bloomLevels: number;
  /**
   * How far down the pyramid starts.
   *
   * Zero means the first buffer is half the width of the screen, one means a
   * quarter. Every level below the first is cheap — it is a quarter of the
   * one above — so almost the whole cost of the bloom is in that first buffer
   * and in the prefilter that fills it. Starting one step lower is a
   * three-quarter saving on the expensive part for a spill that is, by
   * construction, too soft for anyone to see the resolution of.
   */
  bloomStart: number;
  /**
   * Where a highlight starts to spill, measured in linear light.
   *
   * Well above one, and that is the whole of the tuning. These rooms are lit
   * by a sun of intensity four and a half, so a wall facing the window sits
   * at two or three before the tone curve brings it back to something like
   * white — set the threshold at one and every lit surface in the room is a
   * light source, which is not bloom but fog. What should spill is what is
   * genuinely blown: the window itself, the filament, a screen, the one
   * highlight running along a brass pull.
   */
  bloomThreshold: number;
  bloomStrength: number;
  /** Light scattered through the air between the window and the room. */
  scatter: boolean;
  scatterSamples: number;
  scatterStrength: number;
  /**
   * Occlusion measured off the depth buffer, for the things the bake cannot
   * see.
   *
   * The room's own shading is traced properly and once — a hundred and fifty
   * thousand rays through a real BVH, baked into the vertices, and better than
   * anything a screen-space approximation could produce. What it cannot cover
   * is anything that moves after it has run: a mug picked up and put down
   * somewhere else, a laptop slid along the worktop, a phone laid on a stand.
   * Those arrive with their own small bake and then float, because nothing has
   * told the worktop they are there.
   *
   * This is the part that does. It is deliberately short-range — a hand's
   * breadth, not a room — so that it adds the seam where two things meet and
   * leaves the room's own shading, which is better, entirely alone.
   */
  ao: boolean;
  aoSamples: number;
  aoStrength: number;

  /**
   * Sensor, at the very end. The lens's other habit — how far the corners
   * fall away — belongs to the room rather than to the tier, and lives in
   * `Grade` in `post.ts`.
   */
  grain: number;
  fringe: number;

  /* -- the parts that are purely decorative ---------------------------- */
  shafts: boolean;
  /**
   * How hot an additive highlight is drawn.
   *
   * The sprites, cones and beams are light rather than surface, and they are
   * added straight into the buffer. With the tone curve running inside the
   * materials they had to stop at white, because anything above it was
   * clipped on the way out; with the curve moved to the composite there is
   * somewhere above white for them to go, and going there is the difference
   * between a bulb that is drawn bright and a bulb that blows out and takes
   * the air around it with it. On a tier with no post chain the ceiling is
   * still white, so the boost is one.
   */
  emissive: number;
  /**
   * And how strongly the hand-placed air is drawn.
   *
   * Separate from `emissive`, because a filament and a cone of lit dust are
   * not the same kind of thing. A filament should go as far above white as the
   * buffer allows — it is the source, and everything else in the frame is
   * reacting to it. Lit air is the reaction: it is already the faint end of
   * something, and doubling it turns a shaft of light into a sheet of milk.
   *
   * It goes *down* rather than up where there is a post chain, because the
   * chain is now scattering light through the frame for real and the cards
   * are no longer carrying the effect on their own — they are seeding it.
   * Two hand-placed cards at half strength plus a pass that follows the camera
   * beats two cards at full strength and nothing else.
   */
  airborne: number;
  /**
   * And how much brighter it is outside than in.
   *
   * The window is a photograph of a street pasted into a wall, and until there
   * was somewhere above white to put it, it had to be pasted in at white —
   * which is the same brightness as the plaster beside it. That is not what a
   * window looks like from inside a room. Expose for a kitchen and the world
   * outside is three or four stops over; it goes completely white, it eats its
   * own frame, and the wall for a foot around it lifts. Every photograph ever
   * taken indoors has that in it.
   *
   * So the glass is drawn at three and a half times white and the tone curve
   * brings it back to white on its own, having first let the prefilter see how
   * far over it really was. That single number is most of why these rooms now
   * read as rooms with daylight in them rather than as rooms with a bright
   * rectangle in one wall.
   */
  daylight: number;
  foliageScale: number;
}

const TIERS: Record<Tier, Omit<Settings, 'tier' | 'auto'>> = {
  high: {
    antialias: true,
    powerPreference: 'high-performance',
    maxPixelRatio: 1.75,
    maxPixels: 2_600_000,
    shadowType: THREE.PCFShadowMap,
    softShadows: true,
    blockerSamples: 12,
    shadowSamples: 18,
    sunShadow: 2048,
    spotShadow: 1024,
    spotShadows: true,
    fills: 2,
    texSteps: 0,
    anisotropy: 8,
    roughnessMaps: true,
    rayBudget: 150_000,
    maxSegments: 8,
    probe: 160,
    post: true,
    samples: 4,
    bloomLevels: 6,
    bloomStart: 0,
    bloomThreshold: 2.4,
    bloomStrength: 0.115,
    scatter: true,
    scatterSamples: 28,
    scatterStrength: 0.85,
    ao: true,
    aoSamples: 14,
    aoStrength: 0.48,
    grain: 0.016,
    fringe: 0.0034,
    emissive: 2.1,
    airborne: 0.6,
    daylight: 3.5,
    shafts: true,
    foliageScale: 1,
  },
  medium: {
    antialias: true,
    powerPreference: 'high-performance',
    maxPixelRatio: 1.4,
    maxPixels: 1_900_000,
    shadowType: THREE.PCFShadowMap,
    softShadows: true,
    blockerSamples: 8,
    shadowSamples: 12,
    sunShadow: 1280,
    spotShadow: 768,
    spotShadows: true,
    fills: 2,
    texSteps: 1,
    anisotropy: 4,
    roughnessMaps: true,
    rayBudget: 72_000,
    maxSegments: 5,
    probe: 96,
    post: true,
    samples: 2,
    bloomLevels: 5,
    bloomStart: 0,
    bloomThreshold: 2.5,
    bloomStrength: 0.105,
    scatter: true,
    scatterSamples: 16,
    scatterStrength: 0.75,
    ao: true,
    aoSamples: 8,
    aoStrength: 0.42,
    grain: 0.014,
    /* Off. Three taps of the scene buffer instead of one is a third more
       bandwidth on the one pass that runs at full resolution, to buy an
       effect measured in fractions of a pixel. */
    fringe: 0,
    emissive: 2.1,
    airborne: 0.62,
    daylight: 3.3,
    shafts: true,
    foliageScale: 0.8,
  },
  low: {
    antialias: false,
    powerPreference: 'default',
    maxPixelRatio: 1,
    maxPixels: 1_150_000,
    /*
     * PCF rather than Basic. Unfiltered shadows on a 1024 map across a room
     * eight metres wide are stair-stepped enough to read as a bug, and the
     * filter is four taps — next to nothing beside the pass that produced the
     * map in the first place, which is what was actually worth cutting.
     */
    shadowType: THREE.PCFShadowMap,
    softShadows: false,
    blockerSamples: 0,
    shadowSamples: 0,
    sunShadow: 1024,
    spotShadow: 0,
    spotShadows: false,
    fills: 0,
    texSteps: 2,
    /* Not one. Anisotropic filtering exists for exactly the two surfaces this
       scene is mostly made of — a floor and a worktop seen at a glancing
       angle — and without any at all they turn to mush a metre away. Two taps
       is the cheapest step up from none and recovers most of it. */
    anisotropy: 2,
    roughnessMaps: false,
    rayBudget: 30_000,
    maxSegments: 3,
    probe: 64,
    /*
     * No post chain at all.
     *
     * Not a cheaper one: a cheaper one would still mean a floating-point
     * buffer the size of the screen, written once and read three times, and
     * bandwidth is the thing a tiled mobile GPU has least of. The room goes
     * straight to the canvas here exactly as it always did, tone mapped in
     * the materials, with the hand-placed sprites and beams standing in for
     * the spill — which is what they were built to do and what they are still
     * good at.
     */
    post: false,
    samples: 0,
    bloomLevels: 0,
    bloomStart: 0,
    bloomThreshold: 1.1,
    bloomStrength: 0,
    scatter: false,
    scatterSamples: 0,
    scatterStrength: 0,
    ao: false,
    aoSamples: 0,
    aoStrength: 0,
    grain: 0,
    fringe: 0,
    emissive: 1,
    airborne: 1,
    daylight: 1,
    shafts: false,
    foliageScale: 0.55,
  },
};

/* ----------------------------------------------------------------- guess */

/**
 * What the GPU says it is, from a context opened and immediately thrown away.
 *
 * Worth the throwaway context: `hardwareConcurrency` cannot tell a fanless
 * tablet from a workstation, and the renderer string can. It has to happen
 * before the real renderer is constructed, because `antialias` and
 * `powerPreference` are fixed for the life of a WebGL context — by the time
 * there is something to measure, it is too late to ask for less.
 */
function probeGpu(): { name: string; webgl2: boolean; maxTexture: number } {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { name: '', webgl2: false, maxTexture: 0 };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    const maxTexture = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) ?? 0;
    const webgl2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { name, webgl2, maxTexture };
  } catch {
    return { name: '', webgl2: false, maxTexture: 0 };
  }
}

/** Software rasterisers. Nothing here is going to help them; give them least. */
const SOFTWARE = /swiftshader|llvmpipe|softwarerasterizer|basic render|microsoft basic/i;

/**
 * What class of part that name is, as far as a name can say.
 *
 * This is a ceiling rather than a score, because that is what the information
 * actually is. A budget phone with eight cores and eight gigabytes still has
 * a GPU with two shader cores in it, and no amount of counting the things
 * that are cheap to count will talk it out of that. The cores and the memory
 * decide where inside the ceiling it lands; the ceiling itself is the GPU's.
 *
 * The names are read properly rather than pattern-matched loosely, because
 * the loose version quietly matched nothing. ARM stopped numbering Mali by
 * speed at Bifrost: the digits are a class and a generation, not a rank, and
 * they are two digits in one era and three in the next. A pattern written for
 * three digits — `mali-[tg]?[1-6]\d{2}` — misses Mali-G52 and Mali-G57, which
 * between them are most of the Helio G-series and half of Dimensity, and
 * misses Mali-G78 and G715, which are every Tensor. It matched PowerVR and
 * nothing else, so in practice an Android phone was sorted entirely by the
 * width of its screen: every phone got Medium and every tablet got High,
 * whether it cost a hundred pounds or a thousand.
 */
type GpuClass = 'weak' | 'modest' | 'unknown';

function classify(name: string): GpuClass {
  if (!name) return 'unknown';

  /*
   * Mali, which is every MediaTek and every Tensor, and the reason this
   * function exists.
   *
   * Utgard (a bare number) and Midgard (T-something) are pre-2017 and slow at
   * anything with a shadow map in it. After that the leading digit is the
   * class — G31, G52, G57, G310, G510 are the entry parts; G68 and up, and
   * G610 and up, are the premium ones — and the digit count is only which
   * decade ARM was in when it named them. So read the leading digit and
   * ignore the rest, which is the one rule that holds across both.
   */
  const mali = /mali[-\s]?([tg])?\s?(\d{2,4})/i.exec(name);
  if (mali) {
    const [, series, digits] = mali;
    if (!series || series.toLowerCase() === 't') return 'weak';
    return Number(digits[0]) >= 6 ? 'modest' : 'weak';
  }

  /* Adreno numbers its parts in hundreds and does mean them as a rank. The
     600 series straddles the line — a 610 and a 650 are four years and an
     order of magnitude apart — so it is split rather than taken whole. */
  const adreno = /adreno\D*(\d{3})/i.exec(name);
  if (adreno) {
    const n = Number(adreno[1]);
    if (n < 620) return 'weak';
    if (n < 700) return 'modest';
    return 'unknown';
  }

  /* PowerVR and its IMG-branded successors are the other half of the budget
     MediaTek line, and Vivante and VideoCore are set-top boxes and Pis. */
  if (/powervr|\bimg\s+[bc]x|videocore|vivante|\bgc\d{4}/i.test(name)) return 'weak';
  /* Samsung's RDNA parts, in the Exynos flagships: quick, and hot. */
  if (/xclipse/i.test(name)) return 'modest';
  /* Intel's integrated parts, which are the desktop end of the same problem.
     The HD 3000/4000/5000 generations are weak by any measure; UHD 6xx and up
     are slow at this and still attached to a fan and a real CPU, so they stop
     at Medium rather than dropping to Low — a laptop panel is not dense
     enough to give up multisampling on. Intel numbered the old ones in
     thousands and the newer ones in hundreds, so the digit count is the
     generation: HD 4000 is 2012 and UHD 620 is 2017. */
  if (/intel\(r\)\s+(hd|uhd)\s+graphics\s+[345]\d{3}\b/i.test(name)) return 'weak';
  if (/intel\(r\)\s+(hd|uhd)\s+graphics\b/i.test(name)) return 'modest';

  return 'unknown';
}

function detect(): Tier {
  const gpu = probeGpu();
  if (!gpu.maxTexture) return 'low';
  if (SOFTWARE.test(gpu.name)) return 'low';

  let score = 3;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 3) score -= 2;
  else if (cores <= 6) score -= 1;

  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined) {
    if (memory <= 2) score -= 2;
    else if (memory <= 4) score -= 1;
  }

  if (!gpu.webgl2) score -= 1;
  if (gpu.maxTexture < 8192) score -= 1;

  /* A phone with no reported memory and a GPU string the browser withheld —
     Safari withholds it — still shouldn't open on the top tier. */
  const touch = isHandheld();
  if (touch && !gpu.name) score -= 1;
  if (touch && Math.min(screen.width, screen.height) <= 480) score -= 1;

  const tier: Tier = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';

  /*
   * And no handheld opens on High, whatever it says about itself.
   *
   * This is not scepticism about the GPU. A current Adreno reports eight
   * cores, eight gigabytes, WebGL 2 and a sixteen-thousand-pixel texture
   * limit, scores a clean three, gives a name this file has no reason to
   * doubt — and is sitting behind a passive heatsink the size of a stamp. It
   * will draw the top tier beautifully for about ninety seconds.
   *
   * The tier decides the things that are fixed for the life of the room and
   * cannot be walked back: how large the textures were baked, how many rays
   * the light trace fired, how big the shadow maps are. Those are the wrong
   * things to be optimistic about on a device whose speed is a function of
   * how long it has been held. So the ceiling is Medium, `handheld` above
   * takes away what a tiler cannot absorb at any tier, and the frame-time
   * ladder in `useRoomScene` handles whatever is left — which is the only one
   * of the three that can see the heat arrive.
   */
  if (touch && tier === 'high') return 'medium';

  /*
   * And then the ceiling, which overrules all of it.
   *
   * `modest` stops at Medium rather than dropping to Low, and Tensor is the
   * case that shape is for. A Mali-G78 with twenty cores in it is not a weak
   * GPU by any measure taken in the first thirty seconds — it is the thermal
   * envelope around it that is weak, and a phone that is fast until it is
   * warm cannot be caught by anything asked at load. So it opens at Medium,
   * where it genuinely does run, and the frame-time ladder in `useRoomScene`
   * takes it down from there if and when the heat arrives.
   */
  const kind = classify(gpu.name);
  if (kind === 'weak') return 'low';
  if (kind === 'modest' && tier === 'high') return 'medium';
  return tier;
}

/* -------------------------------------------------------------- handheld */

/**
 * A machine you hold in your hand, which is a different kind of machine.
 *
 * Not a slower one — a modern phone has a GPU that would have been a
 * workstation a decade ago, and the tier above has already decided how much
 * of one. This is about the *shape* of it. Every phone and tablet GPU is a
 * tile-based deferred renderer: it draws the screen in small squares held in
 * on-chip memory and writes each square out once, which makes it wonderful at
 * shading and terrible at anything that reads the whole frame back.
 *
 * Which is precisely what a post chain is. Every pass costs a full store of
 * one buffer and a full load of the next — bandwidth that a desktop card has
 * in embarrassing quantity and a phone measures out by the milliwatt. On a
 * desktop the passes are almost free next to the shading; on a phone they are
 * most of the frame.
 *
 * So the things taken away here are the ones with the worst ratio of what
 * they cost on a tiler to what they add: multisampling a floating-point
 * buffer, which doubles the size of every tile; the occlusion pass and its
 * two blurs, which are three more whole-frame round trips for a shading cue
 * the traced bake has mostly already provided; the scattering, which is
 * another; and a second and third shadow-casting light, each of which is a
 * complete extra rasterisation of the room.
 *
 * What is deliberately *kept* is everything that makes the room look like the
 * room: the spill, the tone curve, the grade, the traced light, and shadows
 * that soften with distance. A phone should get the same room, drawn with
 * fewer round trips — not a worse one.
 *
 * Applied on top of whichever tier was chosen or asked for, because it is a
 * fact about the hardware rather than a preference about quality. Somebody who
 * taps High on a tablet is asking for the big textures, the long ray budget
 * and the full shadow maps, and they get all three.
 */
function handheld(s: Omit<Settings, 'tier' | 'auto'>): Omit<Settings, 'tier' | 'auto'> {
  return {
    ...s,
    /* The single most expensive line in this file on a tiler. A multisampled
       half-float attachment is four bytes a sample a channel held in tile
       memory, and tile memory is the whole trick. The display is dense enough
       that the edges were never the problem — which is the same argument the
       renderer's own `antialias` flag lost, one layer down. */
    samples: 0,
    /*
     * The budget, and the one number here that is worth arguing about.
     *
     * It was a flat ceiling, which quietly charged two very different
     * machines the same rent. A tier with no post chain draws the room once,
     * to the canvas, and a million and a half pixels is a million and a half
     * pixels. A tier with one draws the room into a half-float buffer, reads
     * that buffer back at full resolution to prefilter it, and reads it back
     * again at full resolution to composite it — three trips over the same
     * area, two of them at eight bytes a pixel, on a part whose whole trick
     * is never moving a whole frame in or out of memory.
     *
     * So the ceiling now knows which of those it is paying for. A phone with
     * a post chain gets about a fifth fewer pixels than one without, which is
     * a tenth off each edge and is not a thing anybody can see on a display
     * this dense — and it comes off the passes that cost the most.
     */
    maxPixels: Math.min(s.maxPixels, s.post ? 1_150_000 : 1_400_000),
    maxPixelRatio: Math.min(s.maxPixelRatio, 1.35),
    ao: false,
    aoSamples: 0,
    aoStrength: 0,
    scatter: false,
    scatterSamples: 0,
    scatterStrength: 0,
    /* Daylight draws the shadows that matter in both rooms. A pendant that
       also casts is a second pass over every triangle in the studio for a
       pool of light that is already being drawn by the cone under it. */
    spotShadows: false,
    spotShadow: 0,
    /*
     * And the daylight's own shadow goes back on the stock filter.
     *
     * The most expensive line on this list, and the last one to be written,
     * because it is the one that costs a look rather than a detail. Measured
     * on the handheld profile, the two passes come to about a quarter of
     * everything it takes to draw the room — more than the textures, the
     * doorway lights and the whole post chain put together. A quarter of the
     * frame is not a refinement; on a part that is thermally limited it is the
     * difference between a room that holds sixty and a room that settles at
     * thirty and then gets worse as it warms.
     *
     * What is lost is real and worth naming: a shadow that is knife-sharp
     * where a mug meets the worktop and gone a metre away becomes one that is
     * the same softness everywhere. What replaces it is not nothing — three
     * of three.js's own taps, given a width below in `lightWidth` — so the
     * edges stay smooth and only the *variation* goes. A room with evenly soft
     * shadows still reads as a room. A room at half resolution does not, and
     * that is what this buys back.
     *
     * It is the ladder's own last rung, taken at the start instead: the frame
     * -time ladder in `useRoomScene` used to reach this after two thirds of a
     * second of visible stutter, on a machine that was never going to be able
     * to afford it. Better to open where it was going to end up.
     */
    softShadows: false,
    blockerSamples: 0,
    shadowSamples: 0,
    /* One of the studio's doorway pair, not both. See `fills`. */
    fills: Math.min(s.fills, 1),
    /*
     * The third texture per surface, which is the cheapest thing on this list
     * to give up and the hardest to notice gone.
     *
     * It is a fetch at every lit pixel of every surface in the room — a third
     * of all the sampling the room does — and what it buys is the difference
     * between oak that is satin everywhere and oak that is a shade duller
     * down the open pores. That difference is worth having on a display you
     * sit in front of. It is not worth a third of the sampling on a part
     * being asked for thirty frames a second through a passive heatsink, and
     * at arm's length on a phone it is not visible at all.
     *
     * It also takes a canvas, a levels pass and a texture upload per surface
     * out of the wait before the room appears, which on a slow phone is the
     * other thing the reader is feeling.
     */
    roughnessMaps: false,
    /*
     * And two taps of anisotropy rather than four.
     *
     * Anisotropic filtering is a multiplier on every one of those fetches,
     * taken where the surface is oblique — which, in a room, is the floor and
     * the worktop, over most of the frame. Four taps against two is twice the
     * sampling for the far half of a floor that is, on a phone held at arm's
     * length, about a centimetre tall. Two is the step that keeps it from
     * turning to mush; the rest is for a bigger screen.
     */
    anisotropy: Math.min(s.anisotropy, 2),
    bloomLevels: Math.min(s.bloomLevels, 4),
    bloomStart: 1,
    /* The beams go too. They are the same bargain as the scattering — a lot
       of additive overdraw for some air — and overdraw is the other thing a
       tiler cannot absorb. */
    shafts: false,
  };
}

/**
 * Whether this is one. Read once, because the answer does not change.
 *
 * It used to be one question — is the pointer coarse — and a device does not
 * grow a mouse, so reading it once was safe. Except that an iPad does. Put one
 * in a keyboard case and iPadOS reports a *fine* pointer, because there is now
 * a trackpad under it, and every cut in `handheld` above was silently skipped:
 * the multisampled float buffer came back, the third texture per surface came
 * back, and the room was drawn as though the thing holding it had a fan in it.
 * It does not. A tablet in a case is a tablet.
 *
 * So the second question is asked as well, and it is asked in the one way that
 * separates an iPad from a Mac. Since iPadOS 13 Safari has claimed to be a Mac
 * in every string it exposes — the platform, the user agent, all of it — and
 * the single thing it cannot fake is the touchscreen: no Mac has ever reported
 * a touch point, and every iPad reports five. Narrow on purpose. A Windows
 * laptop with a touchscreen has a fine pointer and a real thermal envelope,
 * and this is careful not to catch it.
 *
 * Exported so the graphics control can say so. Somebody who taps High on a
 * phone and sees the room change less than they expected is owed the reason,
 * and the reason is not that the setting was ignored.
 */
let coarse: boolean | null = null;
export function isHandheld(): boolean {
  if (coarse === null) {
    try {
      coarse =
        matchMedia('(pointer: coarse)').matches ||
        (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform));
    } catch {
      coarse = false;
    }
  }
  return coarse;
}

/* ---------------------------------------------------------------- resolve */

const KEY = 'cork.graphics';

function readPref(): GraphicsPref {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

let pref: GraphicsPref = readPref();
let detected: Tier | null = null;
let resolved: Settings | null = null;

function resolve(): Settings {
  if (resolved) return resolved;
  if (pref === 'auto' && !detected) detected = detect();
  const tier = pref === 'auto' ? detected! : pref;
  const base = isHandheld() ? handheld(TIERS[tier]) : TIERS[tier];
  resolved = { ...base, tier, auto: pref === 'auto' };
  return resolved;
}

/** The settings the room is being built to. Resolved once, then handed back. */
export function quality(): Settings {
  return resolve();
}

/**
 * A baked texture's edge, stepped down for the machine drawing it.
 *
 * `limit` is for the few surfaces that are the subject rather than the
 * setting. The cork is the thing the whole app is about and is looked at from
 * a hand's breadth away; dropping it two steps to save a megabyte on a phone
 * saves the megabyte and loses the app. A wall nobody ever gets close to can
 * take the full cut.
 */
export function texSize(base: number, limit = 2): number {
  return Math.max(128, base >> Math.min(quality().texSteps, limit));
}

/**
 * How many of a thing to draw into a texture that is about to be shrunk.
 *
 * `texSize` was doing only half the job. It shrinks the canvas, and the draw
 * that fills it runs in the authored coordinate space with the context scaled
 * on the way in — so a quarter-size oak board still stroked all one hundred
 * and ninety grain lines and still stamped all two thousand six hundred open
 * pores, each of them a `fillRect` one pixel tall scaled down to a quarter of
 * a pixel. The memory came down and the work did not, which is the wrong way
 * round: the machines that get the small textures are the machines that are
 * slow at drawing them, and on a phone the canvas work is most of the wait
 * before the room appears.
 *
 * Counts follow the edge rather than the area — half the detail per step, not
 * a quarter — because the point is to track what the texture can still
 * resolve, not to cut as deep as possible. Oak with a tenth of its pores is
 * oak at a distance; oak with a sixteenth of them is a plank.
 *
 * `limit` means what it means in `texSize`, and has to be passed the same way:
 * a surface held back from shrinking is a surface that still has the
 * resolution to show everything that was authored into it.
 */
export function detail(n: number, limit = 2): number {
  return Math.max(1, Math.round(n / (1 << Math.min(quality().texSteps, limit))));
}

/* ------------------------------------------------------------ the control */

const listeners = new Set<() => void>();

export function graphicsPref(): GraphicsPref {
  return pref;
}

/**
 * Choose a tier.
 *
 * Everything downstream — texture sizes, shadow maps, whether the renderer
 * was asked for multisampling — was decided when the room was built, and half
 * of it cannot be changed on a live WebGL context at all. So this invalidates
 * the settings and tells the scene, which tears the renderer down and builds
 * the room again. It is the one action in the app that does that, and it is
 * not one anybody takes twice a minute.
 */
export function setGraphicsPref(next: GraphicsPref) {
  if (next === pref) return;
  pref = next;
  resolved = null;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private browsing: the choice holds for this session only */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The preference, and the tier it currently resolves to. */
export function useGraphics(): { pref: GraphicsPref; tier: Tier } {
  const p = useSyncExternalStore(subscribe, graphicsPref, graphicsPref);
  const tier = useSyncExternalStore(
    subscribe,
    () => quality().tier,
    () => quality().tier,
  );
  return { pref: p, tier };
}
