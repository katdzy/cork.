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
  shadowType: THREE.ShadowMapType;
  sunShadow: number;
  spotShadow: number;
  /** Whether the studio's pendants cast at all, or only the daylight does. */
  spotShadows: boolean;

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

  /* -- the parts that are purely decorative ---------------------------- */
  shafts: boolean;
  foliageScale: number;
}

const TIERS: Record<Tier, Omit<Settings, 'tier' | 'auto'>> = {
  high: {
    antialias: true,
    powerPreference: 'high-performance',
    maxPixelRatio: 1.75,
    maxPixels: 2_600_000,
    shadowType: THREE.PCFShadowMap,
    sunShadow: 2048,
    spotShadow: 1024,
    spotShadows: true,
    texSteps: 0,
    anisotropy: 8,
    roughnessMaps: true,
    rayBudget: 150_000,
    maxSegments: 8,
    probe: 160,
    shafts: true,
    foliageScale: 1,
  },
  medium: {
    antialias: true,
    powerPreference: 'high-performance',
    maxPixelRatio: 1.4,
    maxPixels: 1_900_000,
    shadowType: THREE.PCFShadowMap,
    sunShadow: 1280,
    spotShadow: 768,
    spotShadows: true,
    texSteps: 1,
    anisotropy: 4,
    roughnessMaps: true,
    rayBudget: 72_000,
    maxSegments: 5,
    probe: 96,
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
    sunShadow: 1024,
    spotShadow: 0,
    spotShadows: false,
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
const SOFTWARE = /swiftshader|llvmpipe|softwarerasterizer|basic render/i;
/** Mobile parts a generation or more back, and the old Intel integrated ones. */
const MODEST =
  /mali-[tg]?[1-6]\d{2}\b|adreno \(tm\) [2-5]\d{2}|powervr|videocore|intel\(r\) (hd|uhd) graphics (3|4|5)\d{2}/i;

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

  if (MODEST.test(gpu.name)) score -= 2;
  if (!gpu.webgl2) score -= 1;
  if (gpu.maxTexture < 8192) score -= 1;

  /* A phone with no reported memory and a GPU string the browser withheld —
     Safari withholds it — still shouldn't open on the top tier. */
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && !gpu.name) score -= 1;
  if (coarse && Math.min(screen.width, screen.height) <= 480) score -= 1;

  return score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
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
  resolved = { ...TIERS[tier], tier, auto: pref === 'auto' };
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
