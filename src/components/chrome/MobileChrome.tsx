import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCork, type FilterMode } from '../../lib/store';
import { Wordmark } from './Wordmark';
import { SearchField } from './SearchField';

const VIEWS: { id: FilterMode; label: string }[] = [
  { id: 'all', label: 'All memories' },
  { id: 'favorites', label: 'Favourites' },
  { id: 'recent', label: 'Recently added' },
];

export function MobileBar({
  resultCount,
  onOpenSettings,
}: {
  resultCount: number;
  onOpenSettings(): void;
}) {
  const boards = useCork((s) => s.boards);
  const memories = useCork((s) => s.memories);
  const activeBoardId = useCork((s) => s.activeBoardId);
  const filter = useCork((s) => s.filter);
  const setActiveBoard = useCork((s) => s.setActiveBoard);
  const setFilter = useCork((s) => s.setFilter);
  const addBoard = useCork((s) => s.addBoard);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const active = boards.find((b) => b.id === activeBoardId);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    memories.forEach((m) => map.set(m.boardId, (map.get(m.boardId) ?? 0) + 1));
    return map;
  }, [memories]);

  return (
    <>
      <div
        data-tour="boards"
        className="panel pointer-events-auto absolute left-3 right-3 z-30 flex h-[50px] items-center gap-2 rounded-[16px] px-3"
        style={{ top: 'max(10px, env(safe-area-inset-top, 0px))' }}
      >
        <Wordmark size={19} />

        <button
          onClick={() => setSheet(true)}
          className="ml-1 flex min-w-0 flex-1 items-center gap-[7px] rounded-full px-2 py-[6px] text-left transition-colors active:bg-[rgba(120,92,62,0.12)]"
        >
          <span
            className="h-[8px] w-[8px] shrink-0 rounded-full"
            style={{ background: active?.accent ?? '#bd4f3c' }}
          />
          <span className="truncate text-[13px] font-bold text-[#241d18]">
            {filter === 'board' ? (active?.name ?? 'Board') : (VIEWS.find((v) => v.id === filter)?.label ?? '')}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0 text-[#a6968a]">
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <SearchField resultCount={resultCount} expandedWidth={188} />
      </div>

      <AnimatePresence>
        {sheet && (
          <>
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheet(false)}
              aria-label="Close board list"
              className="fixed inset-0 z-40 cursor-default"
              style={{ background: 'rgba(38,22,10,0.5)', backdropFilter: 'blur(4px)' }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="panel-solid fixed inset-x-0 bottom-0 z-40 rounded-t-[22px] px-4 pb-8 pt-3"
              style={{ maxHeight: '76vh', overflowY: 'auto' }}
            >
              <span className="mx-auto mb-4 block h-[4px] w-[38px] rounded-full bg-[rgba(120,92,62,0.28)]" />

              <span className="eyebrow">Boards</span>
              <ul className="mt-2 space-y-[2px]">
                {boards.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => {
                        setActiveBoard(b.id);
                        setSheet(false);
                      }}
                      className={`flex w-full items-center gap-[10px] rounded-[11px] px-3 py-[11px] text-left ${
                        filter === 'board' && b.id === activeBoardId ? 'bg-[rgba(120,92,62,0.13)]' : ''
                      }`}
                    >
                      <span className="h-[10px] w-[10px] rounded-full" style={{ background: b.accent }} />
                      <span className="flex-1 truncate text-[14.5px] font-semibold text-[#3f362a]">
                        {b.name}
                      </span>
                      <span className="tnum text-[12px] text-[#a6968a]">{counts.get(b.id) ?? 0}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => {
                  const name = window.prompt('Name your board');
                  if (name?.trim()) addBoard(name);
                  setSheet(false);
                }}
                className="mt-1 w-full rounded-[11px] px-3 py-[11px] text-left text-[14px] font-semibold text-[#8b7d70]"
              >
                + New board
              </button>

              <div className="hairline my-3" />

              <ul className="space-y-[2px]">
                {VIEWS.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => {
                        setFilter(filter === v.id ? 'board' : v.id);
                        setSheet(false);
                      }}
                      className={`w-full rounded-[11px] px-3 py-[11px] text-left text-[14.5px] font-semibold ${
                        filter === v.id ? 'bg-[rgba(120,92,62,0.13)] text-[#241d18]' : 'text-[#5d4f42]'
                      }`}
                    >
                      {v.label}
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    onClick={() => {
                      setSheet(false);
                      onOpenSettings();
                    }}
                    className="w-full rounded-[11px] px-3 py-[11px] text-left text-[14.5px] font-semibold text-[#5d4f42]"
                  >
                    Settings
                  </button>
                </li>
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
