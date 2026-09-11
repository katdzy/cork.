import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCork } from '../../lib/store';
import type { Memory } from '../../lib/types';
import { BOARD_H, BOARD_W } from '../../lib/types';
import { searchMatches } from '../../lib/utils';
import { useMedia } from '../../lib/useMedia';
import { addFilesToBoard } from '../../lib/createMemories';
import { SIDEBAR_SPAN } from '../chrome/Sidebar';
import { useRoomScene } from '../../scene/useRoomScene';
import { SCENES, SCENE_ORDER } from '../../scene/themes';
import { BoardItem } from './BoardItem';
import { EmptyBoard } from './EmptyBoard';
import { ZoomControls } from './ZoomControls';
import { FinishPicker } from './FinishPicker';

export interface CanvasApi {
  focusOn(memory: Memory, zoom?: number): void;
  fitAll(): void;
  centerPoint(): { x: number; y: number };
  addFiles(files: File[]): void;
}

interface Props {
  boardId: string;
  shelfOpen?: boolean;
  onRequestAdd(): void;
}

/**
 * The room, with the board in it.
 *
 * The container holds three layers: a WebGL canvas the scene draws the room
 * into, a CSS3D layer the corkboard is placed on, and the flat chrome that
 * floats over both. `useRoomScene` owns the first two — including moving the
 * board element below into the CSS3D layer — so everything here is the same
 * React tree it always was, hanging on a wall that now has depth.
 */
export const BoardCanvas = forwardRef<CanvasApi, Props>(function BoardCanvas(
  { boardId, shelfOpen, onRequestAdd },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const memories = useCork((s) => s.memories);
  const query = useCork((s) => s.query);
  const sceneId = useCork((s) => s.scene);
  const setScene = useCork((s) => s.setScene);
  const view = useCork((s) => s.view);
  const setView = useCork((s) => s.setView);
  const nextScene = SCENES[SCENE_ORDER[(SCENE_ORDER.indexOf(sceneId) + 1) % SCENE_ORDER.length]];

  // Deliberately unsorted: each item paints at its own CSS `z-index`, so DOM
  // order is irrelevant to stacking — and keeping it stable means dragging one
  // photo to the front doesn't reshuffle the list and re-render every sibling.
  const boardMemories = useMemo(
    () => memories.filter((m) => m.boardId === boardId),
    [memories, boardId],
  );

  /* What the board is framed into is the window less whatever is parked on
     top of it — which, at this width, is the sidebar. */
  const insetLeft = useMedia('(min-width: 900px)') ? SIDEBAR_SPAN : 0;

  const scene = useRoomScene(containerRef, boardRef, boardMemories, sceneId, view, insetLeft);
  const [isDropping, setIsDropping] = useState(false);
  const dragDepth = useRef(0);

  /* Switching boards moves the camera up to the wall — you asked to see that
     board. Not on the first render, though: the app opens on the room. */
  const openedOn = useRef(boardId);
  useEffect(() => {
    if (openedOn.current === boardId) return;
    openedOn.current = boardId;
    scene.fitAll();
  }, [boardId, scene.fitAll]);

  /*
   * Escape steps back out to the room — but only when there is nothing nearer
   * to close.
   *
   * Every modal in the app is a live `[aria-modal]` element that closes itself
   * on the same key, and listeners on `window` all fire regardless of who
   * calls `stopPropagation`, so the only way to stay behind them is to ask
   * whether one is open. Asking the document rather than the store means the
   * next modal somebody adds is covered without anyone remembering to.
   */
  useEffect(() => {
    if (view !== 'cork') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (el && /input|textarea|select/i.test(el.tagName)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      setView('room');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, setView]);

  useImperativeHandle(
    ref,
    () => ({
      focusOn: (memory, zoom) => scene.focusOn(memory, zoom),
      fitAll: () => scene.fitAll(),
      centerPoint: scene.centerPoint,
      addFiles: (files: File[]) => void addFilesToBoard(files, scene.centerPoint(), boardId),
    }),
    [scene.focusOn, scene.fitAll, scene.centerPoint, boardId],
  );

  /* -------------------------------------------------------- file drops */
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setIsDropping(true);
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDropping(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDropping(false);
    const files = [...e.dataTransfer.files];
    // dropped onto the board if the pointer was over it, centred if not
    if (files.length) void addFilesToBoard(files, scene.toBoard(e.clientX, e.clientY), boardId);
  };

  /* paste an image straight onto the board */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) void addFilesToBoard(files, scene.centerPoint(), boardId);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [boardId, scene.centerPoint]);

  const isEmpty = boardMemories.length === 0;

  return (
    <div
      ref={containerRef}
      /*
       * `clip`, not `hidden`, and the difference is not cosmetic.
       *
       * `overflow: hidden` makes a scroll container — one you cannot reach with
       * a wheel, but one the *browser* still scrolls whenever something inside
       * it takes focus and is judged to be out of view. Inside this one is a
       * board three and a half thousand pixels wide that routinely overflows
       * it, and every memory on it is a focusable element. So clicking a
       * photograph near the edge of the board scrolled the container to bring
       * it into view, and because the WebGL canvas and every floating control
       * are in that container too, the whole room slid with it: the scene
       * visibly jumped, and the shader and the DOM board came apart, because
       * only one of them knew it had moved.
       *
       * `overflow: clip` clips without ever becoming scrollable, so there is
       * nothing for the browser to scroll and nothing to put back.
       */
      className={`wall relative h-full w-full overflow-clip ${scene.grabbing ? 'grabbing' : 'cursor-default'}`}
      onPointerDown={scene.onPointerDown}
      onPointerMove={scene.onPointerMove}
      onPointerUp={scene.onPointerUp}
      onPointerCancel={scene.onPointerUp}
      onDoubleClick={scene.onDoubleClick}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ touchAction: 'none' }}
    >
      {/* The corkboard. `useRoomScene` lifts this element onto the wall plane;
          until it does, it stays out of sight rather than flashing at 0,0. */}
      <div
        ref={boardRef}
        /*
         * Deliberately not promoted.
         *
         * This carried `will-change: transform` on the theory that a layer the
         * camera re-projects every frame ought to live on the compositor. But
         * the element is 3600 × 2400 CSS pixels — on a retina display that is a
         * texture of thirty-five million pixels, well over a hundred megabytes,
         * and the browser is being asked to hold it whether or not any of it is
         * on screen. `will-change` is for small things that are about to move;
         * MDN says as much. Left alone, the browser rasterises the part you can
         * actually see and nothing else.
         */
        style={{ width: BOARD_W, height: BOARD_H, position: 'absolute', visibility: 'hidden' }}
        /* Transparent. The cork behind it is a lit surface in the scene now, so
           there is nothing board-sized left for the browser to paint here —
           only the memories themselves, wherever they happen to be pinned. */
      >
        {isEmpty && <EmptyBoard onAdd={onRequestAdd} />}

        {boardMemories.map((memory, i) => (
          <BoardItem
            key={memory.id}
            memory={memory}
            index={i}
            toBoard={scene.toBoard}
            dimmed={Boolean(query) && !searchMatches(memory, query)}
          />
        ))}
      </div>

      <ZoomControls
        zoom={scene.zoomLabel}
        raised={shelfOpen}
        nextRoom={nextScene}
        cork={view === 'cork'}
        onToggleCork={() => setView(view === 'cork' ? 'room' : 'cork')}
        onSwapRoom={() => setScene(nextScene.id)}
        onZoomIn={() => scene.zoomBy(1.25)}
        onZoomOut={() => scene.zoomBy(1 / 1.25)}
        onFit={() => scene.fitAll()}
        onReset={() => scene.resetView()}
      />

      <AnimatePresence>
        {scene.finishAt && <FinishPicker at={scene.finishAt} />}
      </AnimatePresence>

      <AnimatePresence>
        {isDropping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-none absolute inset-0 z-40 grid place-items-center"
            style={{ background: 'radial-gradient(80% 60% at 50% 50%, rgba(46,26,10,0.18), rgba(46,26,10,0.4))' }}
          >
            <motion.div
              initial={{ scale: 0.94, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="panel-solid flex flex-col items-center gap-1 rounded-[18px] px-9 py-7"
              style={{ border: '1.5px dashed rgba(120,92,62,0.45)' }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"
                  stroke="#8a6a48"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="mt-1 text-[15px] font-bold text-[#2f2419]">Drop to pin</span>
              <span className="text-[12.5px] text-[#7d6f64]">They’ll land right here</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
