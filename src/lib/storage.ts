import { createStore, get, set, del, clear } from 'idb-keyval';
import type { PersistedState } from './types';

/**
 * Persistence boundary.
 *
 * The app only ever talks to a `CorkStorage`. Swapping IndexedDB for an HTTP
 * backend later means writing one more implementation of this interface —
 * nothing in the UI or store changes.
 */
export interface CorkStorage {
  loadState(): Promise<PersistedState | null>;
  saveState(state: PersistedState): Promise<void>;
  putAsset(id: string, blob: Blob): Promise<void>;
  getAsset(id: string): Promise<Blob | undefined>;
  deleteAsset(id: string): Promise<void>;
  reset(): Promise<void>;
}

const STATE_KEY = 'cork.state';

// Separate databases on purpose: idb-keyval creates its object store in the
// upgrade handler of whichever call opens the database first, so two stores
// sharing one database name leaves the second one missing.
const stateStore = createStore('cork-state', 'state');
const assetStore = createStore('cork-assets', 'assets');

/**
 * How long the first read is given before the app stops waiting for it.
 *
 * A failed IndexedDB request rejects and there is a `catch` below for that. A
 * *blocked* one does neither: an upgrade behind another tab's open connection,
 * or a deletion that never completed, leaves the request — and everything
 * queued behind it — pending for as long as the thing in front of it lives.
 * Nothing rejects, nothing resolves, and because the board cannot be drawn
 * until it is known what is on it, the app sits on its splash screen for ever
 * with no way out, not even a reload.
 *
 * Reading one document from a local database is single-digit milliseconds. Two
 * seconds is not a deadline, it is a diagnosis.
 */
const READ_TIMEOUT = 2000;

const TIMED_OUT = Symbol('timed out');

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Set when the store was there but would not answer.
 *
 * It is the difference between "there is no board" and "there may be a board
 * and I could not see it", and everything turns on it: writing a fresh demo
 * board over a real one is the only failure here that cannot be undone. So a
 * read that times out puts the session in a state where it will happily draw
 * a board and refuse to save one.
 */
let unreadable = false;

/** Whether anything changed this session can be written down. */
export const storageUnreadable = () => unreadable;

class IndexedDbStorage implements CorkStorage {
  async loadState() {
    try {
      const raw = await withTimeout(get<PersistedState>(STATE_KEY, stateStore), READ_TIMEOUT);
      if (raw === TIMED_OUT) {
        unreadable = true;
        console.warn('Cork: the board store did not answer; opening on a demo board and not saving over it');
        return null;
      }
      return raw ?? null;
    } catch {
      /* A rejection is an answer: the store is unusable — private browsing,
         no quota — rather than unread. There is nothing in there to protect,
         so the seed goes ahead and the write can fail as harmlessly as the
         read did. */
      return null;
    }
  }

  async saveState(state: PersistedState) {
    if (unreadable) return;
    try {
      await set(STATE_KEY, state, stateStore);
    } catch (err) {
      console.warn('Cork: could not save board state', err);
    }
  }

  async putAsset(id: string, blob: Blob) {
    await set(id, blob, assetStore);
  }

  async getAsset(id: string) {
    try {
      return await get<Blob>(id, assetStore);
    } catch {
      return undefined;
    }
  }

  async deleteAsset(id: string) {
    try {
      await del(id, assetStore);
    } catch {
      /* asset already gone */
    }
  }

  async reset() {
    await clear(stateStore);
    await clear(assetStore);
  }
}

export const storage: CorkStorage = new IndexedDbStorage();

/* ------------------------------------------------------------------
   Asset URL cache — blobs become object URLs once, then get reused.
   ------------------------------------------------------------------ */

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | undefined>>();

export function cachedAssetUrl(assetId: string): string | undefined {
  return urlCache.get(assetId);
}

export function resolveAsset(assetId: string): Promise<string | undefined> {
  const hit = urlCache.get(assetId);
  if (hit) return Promise.resolve(hit);

  const inFlight = pending.get(assetId);
  if (inFlight) return inFlight;

  const task = storage.getAsset(assetId).then((blob) => {
    pending.delete(assetId);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    urlCache.set(assetId, url);
    return url;
  });

  pending.set(assetId, task);
  return task;
}

export function registerAssetUrl(assetId: string, url: string) {
  urlCache.set(assetId, url);
}

export function releaseAsset(assetId: string) {
  const url = urlCache.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(assetId);
  }
  void storage.deleteAsset(assetId);
}
