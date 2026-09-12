import { useSyncExternalStore } from 'react';

/**
 * Which laptop is open on the counter, and what colour it came in.
 *
 * Two machines, because the one thing everybody's desk disagrees about is
 * which laptop is on it. They are parodies rather than copies — near enough
 * that you know the joke, far enough that nobody's trade mark is doing the
 * work — and they are built differently all the way down: one is a milled
 * aluminium slab with a radius on every corner and a screen that goes nearly
 * to its edge, the other is a matte black box with a thumb-width of bezel, a
 * red dot in the middle of the keyboard and three buttons under it.
 *
 * Each remembers its own colour. Somebody who has a black Tinkerbel and comes
 * back to the yellow Nero should find the yellow Nero, not a yellow Tinkerbel
 * — the colour belongs to the machine, the way it does in a shop.
 */

export type ModelId = 'nero' | 'tinkerbel';

export interface Finish {
  id: string;
  label: string;
  body: number;
}

export interface Model {
  id: ModelId;
  /** What it is called on the lid. */
  label: string;
  /** What to call it where there is only room for one word. */
  short: string;
  finishes: readonly Finish[];
}

export const MODELS: readonly Model[] = [
  {
    id: 'nero',
    label: 'Fujikey Nero',
    short: 'Nero',
    finishes: [
      { id: 'yellow', label: 'Yellow', body: 0xd3d9a8 },
      { id: 'sky', label: 'Light blue', body: 0xb2c9da },
      { id: 'blush', label: 'Pink', body: 0xdfb9b4 },
      { id: 'silver', label: 'Silver', body: 0xc9cbc6 },
      { id: 'midnight', label: 'Midnight', body: 0x2b3140 },
      { id: 'sage', label: 'Sage green', body: 0xb0bb9f },
    ],
  },
  {
    id: 'tinkerbel',
    label: 'Levona Tinkerbel',
    short: 'Tinkerbel',
    finishes: [
      { id: 'black', label: 'Black', body: 0x2b2c2e },
      { id: 'white', label: 'White', body: 0xe6e4de },
      { id: 'purple', label: 'Deep purple', body: 0x4a3a6b },
    ],
  },
];

const byId = (id: ModelId) => MODELS.find((m) => m.id === id) ?? MODELS[0];

const KEY = 'cork.laptop';
/** What the colour was kept under before there was more than one laptop. */
const OLD = 'cork.finish';

interface Kept {
  model: ModelId;
  finishes: Partial<Record<ModelId, string>>;
}

function stored(): Kept {
  const kept: Kept = { model: 'nero', finishes: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Kept>;
      if (parsed.model && MODELS.some((m) => m.id === parsed.model)) kept.model = parsed.model;
      if (parsed.finishes && typeof parsed.finishes === 'object') kept.finishes = parsed.finishes;
      return kept;
    }
    // whoever chose a colour before the second machine existed keeps it
    const old = localStorage.getItem(OLD);
    if (old) kept.finishes.nero = old;
  } catch {
    /* private browsing: it opens the way it shipped */
  }
  return kept;
}

let kept = stored();
const listeners = new Set<() => void>();

/** How the scene puts a colour on, handed over by whoever built the laptop. */
let paint: ((f: Finish) => void) | null = null;
/** How the scene throws the whole machine away and builds the other one. */
let swap: (() => void) | null = null;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* the choice holds for this session only */
  }
}

export function model(): Model {
  return byId(kept.model);
}

export function finish(): Finish {
  const m = model();
  return m.finishes.find((f) => f.id === kept.finishes[m.id]) ?? m.finishes[0];
}

/**
 * Repaint, rather than rebuild.
 *
 * The colour is one multiply in the material and nothing downstream of it
 * knows or cares: the traced light is in the vertex colours, the grain is in
 * the normal map, and neither is a function of the tint. So unlike a change of
 * machine — which has to be built again from nothing — this lands on the next
 * frame, which is the only honest way to let somebody compare two of them.
 */
export function setFinish(id: string) {
  const m = model();
  if (!m.finishes.some((f) => f.id === id) || kept.finishes[m.id] === id) return;
  kept = { ...kept, finishes: { ...kept.finishes, [m.id]: id } };
  save();
  paint?.(finish());
  listeners.forEach((fn) => fn());
}

/** A different machine is different geometry, so this one does cost a rebuild. */
export function setModel(id: ModelId) {
  if (id === kept.model || !MODELS.some((m) => m.id === id)) return;
  kept = { ...kept, model: id };
  save();
  swap?.();
  listeners.forEach((fn) => fn());
}

/** Register the two. Called again every time the laptop is built. */
export function onPaint(fn: (f: Finish) => void) {
  paint = fn;
}

export function onSwap(fn: () => void) {
  swap = fn;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = () => kept;

/** The pair, for anything that draws a picker. */
export function useLaptop(): { model: Model; finish: Finish } {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { model: model(), finish: finish() };
}
