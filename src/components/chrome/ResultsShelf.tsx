import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Memory } from '../../lib/types';
import { useCork } from '../../lib/store';
import { useAssetUrl } from '../board/MemoryObject';
import { clamp, formatDate } from '../../lib/utils';

const TYPE_TONE: Record<string, string> = {
  sticky: 'linear-gradient(160deg,#f8e6a4,#eecf72)',
  note: 'linear-gradient(160deg,#fffdf4,#efe6d0)',
  ticket: 'linear-gradient(160deg,#fdf5e2,#e6d3a8)',
  label: 'linear-gradient(160deg,#f0e3c6,#dcc79c)',
};

function Thumb({ memory, onPick }: { memory: Memory; onPick(m: Memory): void }) {
  const src = useAssetUrl(memory);
  const boards = useCork((s) => s.boards);
  const board = boards.find((b) => b.id === memory.boardId);
  const label = memory.title || memory.caption || memory.text?.split('\n')[0] || 'Untitled';

  return (
    <button
      onClick={() => onPick(memory)}
      className="group flex w-[86px] shrink-0 flex-col gap-[6px] text-left"
      title={label}
    >
      <span
        className="relative block h-[72px] w-[86px] overflow-hidden rounded-[7px] transition-transform duration-200 group-hover:-translate-y-[3px]"
        style={{
          background: TYPE_TONE[memory.type] ?? '#e2d6bd',
          boxShadow: '0 1px 2px rgba(58,34,12,0.28), 0 6px 12px -6px rgba(48,28,10,0.5)',
        }}
      >
        {src && (
          <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
        )}
        {!src && (
          <span className="hand absolute inset-0 grid place-items-center px-2 text-center text-[13px] leading-tight text-[#5a4718]">
            {memory.text?.split('\n')[0] ?? label}
          </span>
        )}
        {memory.favorite && (
          <span className="absolute bottom-[3px] right-[4px] text-[11px] text-[#e8746080]" style={{ color: '#f0e0d4' }}>
            ♥
          </span>
        )}
      </span>
      <span className="block truncate text-[11px] font-semibold leading-tight text-[#3f362a]">
        {label}
      </span>
      <span className="flex items-center gap-[5px] text-[10px] text-[#9a8b7d]">
        <span
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: board?.accent ?? '#bd4f3c' }}
        />
        <span className="truncate">{memory.date ? formatDate(memory.date) : (board?.name ?? '')}</span>
      </span>
    </button>
  );
}

interface Base {
  left: number;
  top: number;
  w: number;
  h: number;
}

/** Where the reader last left the shelf, remembered for the session. */
let rememberedOffset = { x: 0, y: 0 };

const EDGE = 12;

export function ResultsShelf({
  title,
  results,
  onPick,
  onClose,
}: {
  title: string;
  results: Memory[];
  onPick(m: Memory): void;
  onClose(): void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(() => ({ ...rememberedOffset }));
  const [dragging, setDragging] = useState(false);

  // the ref mirrors the offset so rapid key presses in one tick each build on
  // the last, rather than all recomputing from the same stale render value
  const offsetRef = useRef(offset);
  const baseRef = useRef<Base | null>(null);

  const move = useCallback((next: { x: number; y: number }) => {
    rememberedOffset = next;
    offsetRef.current = next;
    setOffset(next);
  }, []);

  /** Keep the whole panel on screen, whatever it's dragged towards. */
  const clampToViewport = useCallback(
    (x: number, y: number, base: Base) => {
      const minX = EDGE - base.left;
      const minY = EDGE - base.top;
      return {
        x: clamp(x, minX, Math.max(minX, window.innerWidth - EDGE - base.w - base.left)),
        y: clamp(y, minY, Math.max(minY, window.innerHeight - EDGE - base.h - base.top)),
      };
    },
    [],
  );

  /** The panel's rect with no drag applied — measured while the DOM is settled. */
  const measureBase = useCallback((current: { x: number; y: number }) => {
    const r = panelRef.current?.getBoundingClientRect();
    if (!r) return null;
    return { left: r.left - current.x, top: r.top - current.y, w: r.width, h: r.height };
  }, []);

  // after every commit the DOM matches `offset`, so this reading is exact
  useLayoutEffect(() => {
    offsetRef.current = offset;
    baseRef.current = measureBase(offset) ?? baseRef.current;
  });

  const drag = useRef({ active: false, px: 0, py: 0, ox: 0, oy: 0, id: -1, base: null as Base | null });

  const onHandleDown = (e: React.PointerEvent) => {
    // the close button keeps its own click
    if ((e.target as HTMLElement).closest('button')) return;
    const base = measureBase(offsetRef.current);
    if (!base) return;
    const o = offsetRef.current;
    drag.current = { active: true, px: e.clientX, py: e.clientY, ox: o.x, oy: o.y, id: e.pointerId, base };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.id || !d.base) return;
    move(clampToViewport(d.ox + (e.clientX - d.px), d.oy + (e.clientY - d.py), d.base));
  };

  const onHandleUp = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  /** Arrow keys move it too, so it isn't a mouse-only affordance. */
  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const delta =
      e.key === 'ArrowLeft'
        ? [-step, 0]
        : e.key === 'ArrowRight'
          ? [step, 0]
          : e.key === 'ArrowUp'
            ? [0, -step]
            : e.key === 'ArrowDown'
              ? [0, step]
              : null;
    if (delta) {
      e.preventDefault();
      const base = baseRef.current;
      const o = offsetRef.current;
      if (base) move(clampToViewport(o.x + delta[0], o.y + delta[1], base));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      move({ x: 0, y: 0 });
    }
  };

  // a smaller window shouldn't strand the panel off-screen
  useEffect(() => {
    const onResize = () => {
      const o = offsetRef.current;
      const base = measureBase(o);
      if (!base) return;
      const next = clampToViewport(o.x, o.y, base);
      if (next.x !== o.x || next.y !== o.y) move(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToViewport, measureBase, move]);

  return (
    // the wrapper does the centring: Motion owns `transform` on the panel
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
      style={{ bottom: 'max(18px, env(safe-area-inset-bottom, 0px))' }}
    >
      {/* drag offset lives on its own layer, clear of Motion's transform */}
      <div style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 26 }}
          transition={{ type: 'spring', stiffness: 360, damping: 32 }}
          className="panel pointer-events-auto rounded-[16px] px-4 pb-3 pt-[10px]"
          style={{
            width: 'min(760px, calc(100vw - 32px))',
            boxShadow: dragging
              ? '0 2px 4px rgba(52,34,18,0.16), 0 18px 34px -14px rgba(52,34,18,0.45), 0 44px 64px -34px rgba(40,24,10,0.5)'
              : undefined,
          }}
        >
          <div
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onDoubleClick={() => move({ x: 0, y: 0 })}
            onKeyDown={onHandleKeyDown}
            role="button"
            tabIndex={0}
            aria-label={`${title} — drag, or use the arrow keys, to move this panel; Home returns it`}
            title="Drag to move · double-click to reset"
            className={`flex items-center justify-between pb-[9px] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ touchAction: 'none' }}
          >
            <div className="flex items-center gap-[9px]">
              <span aria-hidden="true" className="flex shrink-0 gap-[2px] pr-[1px]">
                {[0, 1].map((c) => (
                  <span key={c} className="flex flex-col gap-[2px]">
                    {[0, 1, 2].map((r) => (
                      <span
                        key={r}
                        className="block h-[2px] w-[2px] rounded-full"
                        style={{ background: 'rgba(120,92,62,0.45)' }}
                      />
                    ))}
                  </span>
                ))}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-bold text-[#241d18]">{title}</span>
                <span className="tnum text-[11.5px] text-[#9a8b7d]">
                  {results.length} {results.length === 1 ? 'memory' : 'memories'}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close results"
              className="grid h-[24px] w-[24px] place-items-center rounded-full text-[#8b7d70] transition-colors hover:bg-[rgba(120,92,62,0.12)] hover:text-[#2f2419]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.6 2.6l6.8 6.8M9.4 2.6l-6.8 6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {results.length ? (
            <div className="scroll-thin flex gap-[14px] overflow-x-auto pb-1">
              {results.slice(0, 40).map((m) => (
                <Thumb key={m.id} memory={m} onPick={onPick} />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-[12.5px] text-[#8b7d70]">
              Nothing here yet — try another word, or pin something new.
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
