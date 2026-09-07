import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCork, type FilterMode } from '../../lib/store';
import { Wordmark } from './Wordmark';

const VIEWS: { id: FilterMode; label: string; icon: ReactNode }[] = [
  {
    id: 'all',
    label: 'All memories',
    icon: (
      <path
        d="M2.6 4.4h10.8v7.2H2.6zM2.6 8.6l2.8-2.2 2.4 1.9 2.3-2.4 3.3 3.1"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: 'favorites',
    label: 'Favourites',
    icon: (
      <path
        d="M8 13.2S2.6 10 2.6 6.3A2.9 2.9 0 0 1 8 4.7a2.9 2.9 0 0 1 5.4 1.6c0 3.7-5.4 6.9-5.4 6.9z"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: 'recent',
    label: 'Recently added',
    icon: (
      <>
        <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M8 5.2V8l2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      </>
    ),
  },
];

export function Sidebar({ onOpenSettings }: { onOpenSettings(): void }) {
  const boards = useCork((s) => s.boards);
  const memories = useCork((s) => s.memories);
  const activeBoardId = useCork((s) => s.activeBoardId);
  const filter = useCork((s) => s.filter);
  const setActiveBoard = useCork((s) => s.setActiveBoard);
  const setFilter = useCork((s) => s.setFilter);
  const addBoard = useCork((s) => s.addBoard);
  const updateBoard = useCork((s) => s.updateBoard);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    memories.forEach((m) => map.set(m.boardId, (map.get(m.boardId) ?? 0) + 1));
    return map;
  }, [memories]);

  const commitNew = () => {
    if (draft.trim()) addBoard(draft);
    setDraft('');
    setAdding(false);
  };

  return (
    <nav
      className="panel pointer-events-auto absolute left-4 top-4 z-30 flex w-[224px] flex-col rounded-[18px] px-3 pb-3 pt-4"
      aria-label="Boards and views"
    >
      <div className="flex items-baseline justify-between px-2">
        <Wordmark size={23} />
        <span className="text-[10px] font-semibold tracking-[0.02em] text-[#a6968a]">
          {memories.length}
        </span>
      </div>
      <p className="mt-[3px] px-2 text-[11.5px] leading-tight text-[#8b7d70]">
        Keep your memories close.
      </p>

      <div className="hairline my-3" />

      <span className="eyebrow px-2">Boards</span>
      <ul className="mt-[6px] space-y-[1px]">
        {boards.map((b) => {
          const active = filter === 'board' && b.id === activeBoardId;
          return (
            <li key={b.id}>
              {renaming === b.id ? (
                <input
                  autoFocus
                  defaultValue={b.name}
                  onBlur={(e) => {
                    updateBoard(b.id, { name: e.target.value.trim() || b.name });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="w-full rounded-[9px] border border-[rgba(120,92,62,0.3)] bg-[rgba(255,255,255,0.7)] px-2 py-[7px] text-[13px] font-semibold outline-none"
                />
              ) : (
                <button
                  onClick={() => setActiveBoard(b.id)}
                  onDoubleClick={() => setRenaming(b.id)}
                  className={`group flex w-full items-center gap-[9px] rounded-[9px] px-2 py-[7px] text-left transition-colors ${
                    active ? 'bg-[rgba(120,92,62,0.13)]' : 'hover:bg-[rgba(120,92,62,0.07)]'
                  }`}
                  title="Double-click to rename"
                >
                  <span
                    className="h-[9px] w-[9px] shrink-0 rounded-full"
                    style={{
                      background: b.accent,
                      boxShadow: `inset 0 0.5px 1px rgba(255,255,255,0.6), 0 1px 2px ${b.accent}55`,
                    }}
                  />
                  <span
                    className={`flex-1 truncate text-[13.5px] ${active ? 'font-bold text-[#241d18]' : 'font-semibold text-[#5d4f42]'}`}
                  >
                    {b.name}
                  </span>
                  <span className="tnum text-[11px] text-[#a6968a]">{counts.get(b.id) ?? 0}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <AnimatePresence initial={false}>
        {adding ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <input
              autoFocus
              value={draft}
              placeholder="Board name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitNew}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNew();
                if (e.key === 'Escape') {
                  setDraft('');
                  setAdding(false);
                }
              }}
              className="mt-1 w-full rounded-[9px] border border-[rgba(120,92,62,0.3)] bg-[rgba(255,255,255,0.7)] px-2 py-[7px] text-[13px] outline-none placeholder:text-[#b3a496]"
            />
          </motion.div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-[2px] flex w-full items-center gap-[9px] rounded-[9px] px-2 py-[7px] text-[13px] font-semibold text-[#8b7d70] transition-colors hover:bg-[rgba(120,92,62,0.07)] hover:text-[#3f362a]"
          >
            <span className="grid h-[9px] w-[9px] place-items-center">
              <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
                <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </span>
            New board
          </button>
        )}
      </AnimatePresence>

      <div className="hairline my-3" />

      <ul className="space-y-[1px]">
        {VIEWS.map((v) => (
          <li key={v.id}>
            <button
              onClick={() => setFilter(filter === v.id ? 'board' : v.id)}
              className={`flex w-full items-center gap-[9px] rounded-[9px] px-2 py-[7px] text-left text-[13px] transition-colors ${
                filter === v.id
                  ? 'bg-[rgba(120,92,62,0.13)] font-bold text-[#241d18]'
                  : 'font-semibold text-[#5d4f42] hover:bg-[rgba(120,92,62,0.07)]'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="text-[#8b7d70]">
                {v.icon}
              </svg>
              {v.label}
            </button>
          </li>
        ))}
        <li>
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-[9px] rounded-[9px] px-2 py-[7px] text-left text-[13px] font-semibold text-[#5d4f42] transition-colors hover:bg-[rgba(120,92,62,0.07)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-[#8b7d70]">
              <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 1.9v1.5M8 12.6v1.5M14.1 8h-1.5M3.4 8H1.9M12.3 3.7l-1 1M4.7 11.3l-1 1M12.3 12.3l-1-1M4.7 4.7l-1-1"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            Settings
          </button>
        </li>
      </ul>
    </nav>
  );
}
