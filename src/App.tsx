import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCork } from './lib/store';
import type { Memory } from './lib/types';
import { searchMatches } from './lib/utils';
import { useMedia } from './lib/useMedia';
import { addFilesToBoard } from './lib/createMemories';
import { BoardCanvas, type CanvasApi } from './components/board/BoardCanvas';
import { Sidebar } from './components/chrome/Sidebar';
import { MobileBar } from './components/chrome/MobileChrome';
import { SearchField } from './components/chrome/SearchField';
import { AddMenu } from './components/chrome/AddMenu';
import { ResultsShelf } from './components/chrome/ResultsShelf';
import { MemoryDetail } from './components/modals/MemoryDetail';
import { SettingsSheet } from './components/modals/SettingsSheet';
import { Toasts } from './components/ui/Toasts';
import { Wordmark } from './components/chrome/Wordmark';
import { Pin } from './components/board/Pin';

const VIEW_TITLES: Record<string, string> = {
  all: 'All memories',
  favorites: 'Favourites',
  recent: 'Recently added',
};

export default function App() {
  const ready = useCork((s) => s.ready);
  const hydrate = useCork((s) => s.hydrate);
  const memories = useCork((s) => s.memories);
  const activeBoardId = useCork((s) => s.activeBoardId);
  const filter = useCork((s) => s.filter);
  const query = useCork((s) => s.query);
  const openId = useCork((s) => s.openId);
  const open = useCork((s) => s.open);
  const select = useCork((s) => s.select);
  const setFilter = useCork((s) => s.setFilter);
  const setQuery = useCork((s) => s.setQuery);
  const setActiveBoard = useCork((s) => s.setActiveBoard);

  const canvasRef = useRef<CanvasApi>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<Memory | null>(null);
  const isDesktop = useMedia('(min-width: 900px)');

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /* a file dropped outside the board shouldn't navigate the browser away */
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const searching = query.trim().length > 0;
  const shelfOpen = searching || filter !== 'board';

  const results = useMemo(() => {
    let pool = memories;
    if (filter === 'favorites') pool = pool.filter((m) => m.favorite);
    if (filter === 'recent') pool = [...pool].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
    if (searching) pool = pool.filter((m) => searchMatches(m, query));
    return pool;
  }, [memories, filter, query, searching]);

  const openMemory = memories.find((m) => m.id === openId) ?? null;
  const boardHasMemories = memories.some((m) => m.boardId === activeBoardId);

  const jumpTo = useCallback(
    (m: Memory) => {
      select(m.id);
      if (m.boardId !== activeBoardId) {
        setActiveBoard(m.boardId, true);
        setPendingFocus(m);
      } else {
        canvasRef.current?.focusOn(m, 1);
      }
    },
    [activeBoardId, select, setActiveBoard],
  );

  useEffect(() => {
    if (!pendingFocus || pendingFocus.boardId !== activeBoardId) return;
    const id = requestAnimationFrame(() => {
      canvasRef.current?.focusOn(pendingFocus, 1);
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFocus, activeBoardId]);

  const pickFiles = () => fileRef.current?.click();

  const centerPoint = useCallback(
    () => canvasRef.current?.centerPoint() ?? { x: 1800, y: 1200 },
    [],
  );

  if (!ready) return <Splash />;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) void addFilesToBoard(files, centerPoint(), activeBoardId);
          e.target.value = '';
        }}
      />

      <BoardCanvas
        ref={canvasRef}
        boardId={activeBoardId}
        shelfOpen={shelfOpen}
        onRequestAdd={pickFiles}
      />

      {isDesktop ? (
        <>
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
          <div className="pointer-events-none absolute right-4 top-4 z-30 flex items-center gap-2">
            <SearchField resultCount={results.length} />
            <AddMenu onPickFiles={(f) => void addFilesToBoard(f, centerPoint(), activeBoardId)} centerPoint={centerPoint} />
          </div>
        </>
      ) : (
        <>
          <MobileBar resultCount={results.length} onOpenSettings={() => setSettingsOpen(true)} />
          <div
            className="pointer-events-none absolute right-4 z-30"
            style={{ bottom: shelfOpen ? 'calc(198px + env(safe-area-inset-bottom, 0px))' : 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 16px))', transition: 'bottom 300ms cubic-bezier(0.22,1,0.36,1)' }}
          >
            <AddMenu
              compact
              onPickFiles={(f) => void addFilesToBoard(f, centerPoint(), activeBoardId)}
              centerPoint={centerPoint}
            />
          </div>
        </>
      )}

      <AnimatePresence>
        {shelfOpen && (
          <ResultsShelf
            title={searching ? `“${query.trim()}”` : (VIEW_TITLES[filter] ?? 'Results')}
            results={results}
            onPick={jumpTo}
            onClose={() => {
              setQuery('');
              setFilter('board');
            }}
          />
        )}
      </AnimatePresence>

      <Toasts raised={shelfOpen} />

      <AnimatePresence>
        {openMemory && <MemoryDetail key={openMemory.id} memory={openMemory} onClose={() => open(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      </AnimatePresence>

      {/* a quiet hint — never over an empty board, which says its own piece */}
      {isDesktop && boardHasMemories && (
        <span
          /* It floats over whatever the camera happens to be on — cork, oak,
             white plaster — so it carries its own paper rather than trusting
             any one of them. The same paper as every other floating control. */
          className="panel pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full px-3.5 py-1 text-[11.5px] font-semibold text-[#5d4f42]"
        >
          drag to look around · scroll to zoom · double-click to move in
        </span>
      )}
    </div>
  );
}

function Splash() {
  return (
    <div className="wall relative grid h-full w-full place-items-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-center"
      >
        <motion.div
          initial={{ y: -26, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.15 }}
          className="mb-4"
        >
          <Pin style="red" size={34} />
        </motion.div>
        <Wordmark size={34} />
        <span className="hand mt-2 text-[19px] text-[#8a7458]">keep your memories close</span>
      </motion.div>
    </div>
  );
}
