import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCork } from '../../lib/store';
import type { Memory } from '../../lib/types';
import { BOARD_H, BOARD_W } from '../../lib/types';
import { searchMatches } from '../../lib/utils';
import { addFilesToBoard } from '../../lib/createMemories';
import { CorkSurface } from './CorkSurface';
import { BoardItem } from './BoardItem';
import { EmptyBoard } from './EmptyBoard';
import { ZoomControls } from './ZoomControls';
import { useViewport } from './useViewport';

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

export const BoardCanvas = forwardRef<CanvasApi, Props>(function BoardCanvas(
  { boardId, shelfOpen, onRequestAdd },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  const memories = useCork((s) => s.memories);
  const query = useCork((s) => s.query);
  const select = useCork((s) => s.select);

  // Deliberately unsorted: each item paints at its own CSS `z-index`, so DOM
  // order is irrelevant to stacking — and keeping it stable means dragging one
  // photo to the front doesn't reshuffle the list and re-render every sibling.
  const boardMemories = useMemo(
    () => memories.filter((m) => m.boardId === boardId),
    [memories, boardId],
  );

  const vp = useViewport(boardId, containerRef, worldRef, boardMemories);
  const [isDropping, setIsDropping] = useState(false);
  const [panning, setPanning] = useState(false);
  const dragDepth = useRef(0);

  const centerPoint = useCallback(() => {
    const c = containerRef.current;
    if (!c) return { x: BOARD_W / 2, y: BOARD_H / 2 };
    return vp.toBoard(c.getBoundingClientRect().left + c.clientWidth / 2, c.getBoundingClientRect().top + c.clientHeight / 2);
  }, [vp]);

  useImperativeHandle(
    ref,
    () => ({
      focusOn: (memory, zoom) => vp.focusOn(memory, zoom),
      fitAll: () => vp.fitAll(),
      centerPoint,
      addFiles: (files: File[]) => void addFilesToBoard(files, centerPoint(), boardId),
    }),
    [vp, centerPoint, boardId],
  );

  /* ------------------------------------------------------ wheel + pinch */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        vp.zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
      } else if (e.shiftKey) {
        vp.panBy(-e.deltaY, 0);
      } else {
        vp.panBy(-e.deltaX, -e.deltaY);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [vp]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef({ active: false, x: 0, y: 0, vx: 0, vy: 0, moved: false });
  const pinch = useRef({ active: false, dist: 0, zoom: 1, mx: 0, my: 0, vx: 0, vy: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    const onItem = (e.target as HTMLElement).closest('[data-memory-id]');
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        active: true,
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: vp.view.current.zoom,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        vx: vp.view.current.x,
        vy: vp.view.current.y,
      };
      pan.current.active = false;
      setPanning(false);
      return;
    }

    if (onItem && e.button !== 1) return;

    pan.current = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      vx: vp.view.current.x,
      vy: vp.view.current.y,
      moved: false,
    };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId))
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current.active && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const box = containerRef.current!.getBoundingClientRect();
      const p = pinch.current;
      const nextZoom = p.zoom * (dist / p.dist);
      const px = p.mx - box.left;
      const py = p.my - box.top;
      vp.set({
        zoom: nextZoom,
        x: px - ((px - p.vx) / p.zoom) * nextZoom + (mx - p.mx),
        y: py - ((py - p.vy) / p.zoom) * nextZoom + (my - p.my),
      });
      return;
    }

    if (!pan.current.active) return;
    const dx = e.clientX - pan.current.x;
    const dy = e.clientY - pan.current.y;
    if (!pan.current.moved && Math.hypot(dx, dy) > 4) pan.current.moved = true;
    vp.set({ x: pan.current.vx + dx, y: pan.current.vy + dy, zoom: vp.view.current.zoom });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current.active = false;

    if (pan.current.active) {
      if (!pan.current.moved && !(e.target as HTMLElement).closest('[data-memory-id]')) {
        select(null);
      }
      pan.current.active = false;
      setPanning(false);
    }
  };

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
    if (files.length) void addFilesToBoard(files, vp.toBoard(e.clientX, e.clientY), boardId);
  };

  /* paste an image straight onto the board */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) void addFilesToBoard(files, centerPoint(), boardId);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [boardId, centerPoint]);

  const isEmpty = boardMemories.length === 0;

  return (
    <div
      ref={containerRef}
      className={`wall relative h-full w-full overflow-hidden ${panning ? 'grabbing' : 'cursor-default'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ touchAction: 'none' }}
    >
      <div
        ref={worldRef}
        className="absolute left-0 top-0"
        style={{ width: BOARD_W, height: BOARD_H, transformOrigin: '0 0', willChange: 'transform' }}
      >
        <CorkSurface />

        {isEmpty && <EmptyBoard onAdd={onRequestAdd} />}

        {boardMemories.map((memory, i) => (
          <BoardItem
            key={memory.id}
            memory={memory}
            index={i}
            zoomRef={vp.zoomRef}
            dimmed={Boolean(query) && !searchMatches(memory, query)}
          />
        ))}
      </div>

      <ZoomControls
        zoom={vp.zoomLabel}
        raised={shelfOpen}
        onZoomIn={() => vp.zoomBy(1.25)}
        onZoomOut={() => vp.zoomBy(1 / 1.25)}
        onFit={() => vp.fitAll()}
        onReset={() => vp.resetView()}
      />

      <AnimatePresence>
        {isDropping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-none absolute inset-0 z-40 grid place-items-center"
            style={{ background: 'radial-gradient(80% 60% at 50% 50%, rgba(46,26,10,0.28), rgba(46,26,10,0.5))' }}
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
