import { useSyncExternalStore } from 'react';

let roomReady = false;
const listeners = new Set<() => void>();
export function markRoomReady() {
  if (roomReady) return;
  roomReady = true;
  listeners.forEach((listener) => listener());
}
export function useRoomReady() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => roomReady,
    () => false,
  );
}
export function needsOpening() {
  try {
    return localStorage.getItem('cork.opening-seen') !== '1' && localStorage.getItem('cork.toured') !== '1';
  } catch { return true; }
}
export function finishOpening() {
  try { localStorage.setItem('cork.opening-seen', '1'); } catch { /* Session state still dismisses it. */ }
}
