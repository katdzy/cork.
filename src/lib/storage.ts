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

class IndexedDbStorage implements CorkStorage {
  async loadState() {
    try {
      const raw = await get<PersistedState>(STATE_KEY, stateStore);
      return raw ?? null;
    } catch {
      return null;
    }
  }

  async saveState(state: PersistedState) {
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
