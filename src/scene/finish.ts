import { useSyncExternalStore } from 'react';

/**
 * What colour the laptop is.
 *
 * The one object on the counter that is a product rather than a thing — a mug
 * is the colour clay fires to and a crate is the colour of pine, but a laptop
 * is whichever of six colours somebody chose in a shop. So it is the one prop
 * worth letting the reader choose, and the choice belongs here rather than in
 * the board's data: it is a preference about the room, like the graphics tier,
 * not a memory that has to survive being exported.
 *
 * These are anodising, not paint. The colour goes into the oxide layer grown
 * on the metal rather than onto it, which is why every one of them is pale and
 * slightly grey — a saturated anodised finish does not exist, and a laptop
 * tinted like one reads as plastic immediately. The dark one is not black
 * either; it is a navy so deep that only the window finds the blue in it.
 */

export type FinishId = 'yellow' | 'sky' | 'blush' | 'silver' | 'midnight' | 'sage';

export interface Finish {
  id: FinishId;
  label: string;
  body: number;
}

export const FINISHES: readonly Finish[] = [
  { id: 'yellow', label: 'Yellow', body: 0xd3d9a8 },
  { id: 'sky', label: 'Light blue', body: 0xb2c9da },
  { id: 'blush', label: 'Pink', body: 0xdfb9b4 },
  { id: 'silver', label: 'Silver', body: 0xc9cbc6 },
  { id: 'midnight', label: 'Midnight', body: 0x2b3140 },
  { id: 'sage', label: 'Sage green', body: 0xb0bb9f },
];

const KEY = 'cork.finish';

function stored(): Finish {
  try {
    const hit = FINISHES.find((f) => f.id === localStorage.getItem(KEY));
    if (hit) return hit;
  } catch {
    /* private browsing, or storage turned off: it opens in yellow */
  }
  return FINISHES[0];
}

let current = stored();
const listeners = new Set<() => void>();

/**
 * How the scene puts the colour on, handed over by whoever built the laptop.
 *
 * One slot rather than a list, because there is only ever one laptop, and a
 * rebuild — a change of graphics tier, a hot reload — replaces the materials
 * the old one closed over. Re-registering drops the stale pair on the floor,
 * which is exactly what should happen to it.
 */
let paint: ((f: Finish) => void) | null = null;

export function finish(): Finish {
  return current;
}

/**
 * Repaint, rather than rebuild.
 *
 * The colour is one multiply in the material and nothing downstream of it
 * knows or cares: the traced light is in the vertex colours, the grain is in
 * the normal map, and neither is a function of the tint. So unlike the
 * graphics tier — which tears the renderer down — this lands on the next
 * frame, which is the only honest way to let somebody compare two of them.
 */
export function setFinish(id: FinishId) {
  const next = FINISHES.find((f) => f.id === id);
  if (!next || next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* the choice holds for this session only */
  }
  paint?.(current);
  listeners.forEach((fn) => fn());
}

/** Register the painter. Called again every time the laptop is built. */
export function onPaint(fn: (f: Finish) => void) {
  paint = fn;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useFinish(): Finish {
  return useSyncExternalStore(subscribe, finish, finish);
}
