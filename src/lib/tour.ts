import { useSyncExternalStore } from 'react';

/**
 * Whether to show somebody round.
 *
 * Once, on the first visit, and never again unless they ask — which is the
 * whole contract of a tour. A second showing is an interruption, and an app
 * that interrupts you on the way back in is one you stop coming back to.
 *
 * The flag is the only thing kept. Which step somebody reached is not worth
 * remembering: a tour they left halfway through is a tour they were done with.
 */

const KEY = 'cork.toured';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    /* private browsing: they get shown round once per session, which is the
       kinder way to be wrong about it */
    return false;
  }
}

let open = !seen();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

export function tourOpen(): boolean {
  return open;
}

/** From Settings, for somebody who wants it again. */
export function startTour() {
  if (open) return;
  open = true;
  notify();
}

export function endTour() {
  if (!open) return;
  open = false;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* nothing to do: it will offer itself again next time, which is survivable */
  }
  notify();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTour(): boolean {
  return useSyncExternalStore(subscribe, tourOpen, tourOpen);
}
