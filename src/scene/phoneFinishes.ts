import { useSyncExternalStore } from 'react';
import type { Finish } from './models';

export const PHONE_FINISHES: readonly Finish[] = [
  { id: 'titanium', label: 'Natural titanium', body: 0xa7a095 },
  { id: 'white', label: 'Pure white', body: 0xffffff },
  { id: 'black', label: 'Black', body: 0x202124 },
  { id: 'orange', label: 'Cosmic orange', body: 0xe87532 },
  { id: 'burgundy', label: 'Burgundy', body: 0x692b40 },
  { id: 'cherry', label: 'Cherry red', body: 0xc52b42 },
  { id: 'navy', label: 'Dark blue', body: 0x253b65 },
  { id: 'mist', label: 'Mist blue', body: 0xa7c6d9 },
  { id: 'sage', label: 'Sage green', body: 0x9daa8c },
];
const KEY = 'cork.phone.finish';
let selected = 'titanium';
try {
  const saved = localStorage.getItem(KEY);
  if (PHONE_FINISHES.some((f) => f.id === saved)) selected = saved!;
} catch { /* Keep the default when storage is unavailable. */ }
const listeners = new Set<() => void>();
let paint: ((finish: Finish) => void) | null = null;
export const phoneFinish = () => PHONE_FINISHES.find((f) => f.id === selected)!;
export function onPhonePaint(fn: (finish: Finish) => void) { paint = fn; }
export function setPhoneFinish(id: string) {
  if (selected === id || !PHONE_FINISHES.some((f) => f.id === id)) return;
  selected = id;
  try { localStorage.setItem(KEY, id); } catch { /* Keep the session choice. */ }
  paint?.(phoneFinish());
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function usePhoneFinish() {
  useSyncExternalStore(subscribe, () => selected, () => selected);
  return phoneFinish();
}
