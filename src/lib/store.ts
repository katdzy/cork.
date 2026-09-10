import { create } from 'zustand';
import type { Board, Memory, PersistedState, PropPlacement, RoomScene } from './types';
import { storage, releaseAsset } from './storage';
import { buildSeedState } from './seed';
import { uid } from './utils';

export type FilterMode = 'board' | 'all' | 'favorites' | 'recent';

interface Toast {
  id: string;
  message: string;
  actionLabel?: string;
  action?: () => void;
}

interface CorkState {
  ready: boolean;
  boards: Board[];
  memories: Memory[];
  activeBoardId: string;
  props: Record<string, PropPlacement>;
  scene: RoomScene;

  /* transient UI ------------------------------------------------ */
  selectedId: string | null;
  openId: string | null;
  query: string;
  filter: FilterMode;
  toasts: Toast[];

  hydrate(): Promise<void>;

  setActiveBoard(id: string, keepFilter?: boolean): void;
  addBoard(name: string): string;
  updateBoard(id: string, patch: Partial<Board>): void;
  deleteBoard(id: string): void;

  addMemory(m: Partial<Memory> & Pick<Memory, 'type'>): Memory;
  updateMemory(id: string, patch: Partial<Memory>, opts?: { silent?: boolean }): void;
  deleteMemory(id: string): void;
  toggleFavorite(id: string): void;
  bringToFront(id: string): number;
  nextZ(): number;

  select(id: string | null): void;
  open(id: string | null): void;
  setQuery(q: string): void;
  setFilter(f: FilterMode): void;
  placeProp(id: string, at: PropPlacement): void;
  setScene(scene: RoomScene): void;

  toast(message: string, actionLabel?: string, action?: () => void): void;
  dismissToast(id: string): void;

  resetEverything(): Promise<void>;
}

const persistable = (s: CorkState): PersistedState => ({
  version: 1,
  boards: s.boards,
  memories: s.memories,
  activeBoardId: s.activeBoardId,
  props: s.props,
  scene: s.scene,
});

let saveTimer: number | undefined;
function schedulePersist(get: () => CorkState) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = get();
    if (s.ready) void storage.saveState(persistable(s));
  }, 320);
}

export const useCork = create<CorkState>((set, get) => ({
  ready: false,
  boards: [],
  memories: [],
  activeBoardId: '',
  props: {},
  scene: 'kitchen',

  selectedId: null,
  openId: null,
  query: '',
  filter: 'board',
  toasts: [],

  async hydrate() {
    const saved = await storage.loadState();
    const state = saved ?? buildSeedState();
    set({
      boards: state.boards,
      memories: state.memories,
      activeBoardId: state.activeBoardId || state.boards[0]?.id || '',
      props: state.props ?? {},
      scene: state.scene ?? 'kitchen',
      ready: true,
    });
    if (!saved) void storage.saveState(state);
  },

  setActiveBoard(id, keepFilter = false) {
    set((s) => ({
      activeBoardId: id,
      selectedId: null,
      openId: null,
      filter: keepFilter ? s.filter : 'board',
    }));
    schedulePersist(get);
  },

  addBoard(name) {
    const accents = ['#bd4f3c', '#5f7f99', '#879a77', '#e5bd63', '#d2938f'];
    const board: Board = {
      id: uid('b'),
      name: name.trim() || 'New board',
      description: '',
      accent: accents[get().boards.length % accents.length],
      createdAt: Date.now(),
    };
    set((s) => ({ boards: [...s.boards, board], activeBoardId: board.id, filter: 'board' }));
    schedulePersist(get);
    return board.id;
  },

  updateBoard(id, patch) {
    set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    schedulePersist(get);
  },

  deleteBoard(id) {
    const { boards, memories } = get();
    if (boards.length <= 1) return;
    memories.filter((m) => m.boardId === id && m.assetId).forEach((m) => releaseAsset(m.assetId!));
    const remaining = boards.filter((b) => b.id !== id);
    set((s) => ({
      boards: remaining,
      memories: s.memories.filter((m) => m.boardId !== id),
      activeBoardId: s.activeBoardId === id ? remaining[0].id : s.activeBoardId,
    }));
    schedulePersist(get);
  },

  nextZ() {
    const { memories } = get();
    return memories.reduce((max, m) => Math.max(max, m.zIndex), 0) + 1;
  },

  addMemory(partial) {
    const now = Date.now();
    const memory: Memory = {
      id: uid(),
      boardId: get().activeBoardId,
      title: '',
      caption: '',
      date: '',
      location: '',
      tags: [],
      frameStyle: 'print',
      pinStyle: 'red',
      x: 1200,
      y: 800,
      rotation: 0,
      scale: 1,
      zIndex: get().nextZ(),
      w: 320,
      h: 230,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    set((s) => ({ memories: [...s.memories, memory] }));
    schedulePersist(get);
    return memory;
  },

  updateMemory(id, patch, opts) {
    set((s) => ({
      memories: s.memories.map((m) =>
        m.id === id ? { ...m, ...patch, updatedAt: opts?.silent ? m.updatedAt : Date.now() } : m,
      ),
    }));
    schedulePersist(get);
  },

  deleteMemory(id) {
    const victim = get().memories.find((m) => m.id === id);
    if (!victim) return;
    set((s) => ({
      memories: s.memories.filter((m) => m.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      openId: s.openId === id ? null : s.openId,
    }));
    schedulePersist(get);

    get().toast('Memory removed', 'Undo', () => {
      set((s) => ({ memories: [...s.memories, victim] }));
      schedulePersist(get);
    });

    // The asset is only really gone once the undo window closes.
    window.setTimeout(() => {
      const stillGone = !get().memories.some((m) => m.id === id);
      if (stillGone && victim.assetId) releaseAsset(victim.assetId);
    }, 8000);
  },

  toggleFavorite(id) {
    const m = get().memories.find((x) => x.id === id);
    if (!m) return;
    get().updateMemory(id, { favorite: !m.favorite });
  },

  bringToFront(id) {
    const z = get().nextZ();
    get().updateMemory(id, { zIndex: z }, { silent: true });
    return z;
  },

  select(id) {
    set({ selectedId: id });
  },

  open(id) {
    set({ openId: id, selectedId: id ?? null });
  },

  setQuery(q) {
    set({ query: q });
  },

  setFilter(f) {
    set({ filter: f, selectedId: null });
  },

  setScene(scene) {
    set({ scene });
    schedulePersist(get);
  },

  placeProp(id, at) {
    set((s) => ({ props: { ...s.props, [id]: at } }));
    schedulePersist(get);
  },

  toast(message, actionLabel, action) {
    const id = uid('t');
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, actionLabel, action }] }));
    window.setTimeout(() => get().dismissToast(id), 5200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  async resetEverything() {
    await storage.reset();
    const fresh = buildSeedState();
    set({
      boards: fresh.boards,
      memories: fresh.memories,
      activeBoardId: fresh.activeBoardId,
      props: {},
      scene: 'kitchen',
      selectedId: null,
      openId: null,
      query: '',
      filter: 'board',
    });
    await storage.saveState(fresh);
  },
}));

