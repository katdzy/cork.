import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import type { Memory } from '../../lib/types';
import { BOARD_W, BOARD_H } from '../../lib/types';
import { useCork } from '../../lib/store';
import { clamp, rand } from '../../lib/utils';
import { MemoryObject } from './MemoryObject';
import { Pin, Tape } from './Pin';
import { registerItemNode } from './itemRects';

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.4;

const SETTLE = { type: 'spring' as const, stiffness: 420, damping: 26, mass: 0.7 };
const LIFT = { type: 'spring' as const, stiffness: 520, damping: 30, mass: 0.6 };

/** A held thing's own colour, away from the brick red that means favourite. */
const HELD = '#5f7f99';

/* The imperative `animate` below runs outside React, so `MotionConfig
   reducedMotion` — which is context — never reaches it. A shake is the one
   piece of motion here that is about the vestibular system rather than about
   taste, so it asks directly. */
const prefersStillness = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  memory: Memory;
  index: number;
  /** Screen → board: a ray from the camera onto the wall the board hangs on. */
  toBoard(clientX: number, clientY: number): { x: number; y: number };
  interactive?: boolean;
  /** Faded because it doesn't match the current search. */
  dimmed?: boolean;
}

function BoardItemBase({ memory, index, toBoard, interactive = true, dimmed = false }: Props) {
  // one selector per action: subscribing to the whole store would re-render
  // every item on the board for any change at all
  const updateMemory = useCork((s) => s.updateMemory);
  const bringToFront = useCork((s) => s.bringToFront);
  const select = useCork((s) => s.select);
  const open = useCork((s) => s.open);
  const toggleFavorite = useCork((s) => s.toggleFavorite);
  const toggleLock = useCork((s) => s.toggleLock);
  const deleteMemory = useCork((s) => s.deleteMemory);
  const toast = useCork((s) => s.toast);
  const selected = useCork((s) => s.selectedId === memory.id);
  const isOpen = useCork((s) => s.openId === memory.id);

  /**
   * Held where it is.
   *
   * A board you have finished arranging is mostly a board you want to stop
   * arranging: the reason to reach for a pinned photograph is to look at it,
   * and every one of those reaches is four pixels of pointer travel away from
   * moving it instead. Locking splits those two intentions apart. What it
   * blocks is position, angle and size — by drag, by handle, by arrow key —
   * and nothing else: a locked memory still selects, still opens, still edits,
   * still favourites. It is an anchor, not a read-only flag.
   */
  const locked = Boolean(memory.locked);

  const nodeRef = useRef<HTMLDivElement>(null);
  const scaleLayerRef = useRef<HTMLDivElement>(null);

  const x = useMotionValue(memory.x);
  const y = useMotionValue(memory.y);
  const rot = useMotionValue(memory.rotation);
  const scale = useMotionValue(memory.scale);
  const lift = useMotionValue(1);
  const combinedScale = useTransform([scale, lift], ([s, l]: number[]) => s * l);

  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [liveScale, setLiveScale] = useState(memory.scale);
  const [liveRot, setLiveRot] = useState(memory.rotation);
  const [zBoost, setZBoost] = useState<number | null>(null);
  const [pinPressed, setPinPressed] = useState(false);

  /* keep motion values in sync when the model changes elsewhere ---------- */
  useEffect(() => {
    if (!dragging) {
      x.set(memory.x);
      y.set(memory.y);
    }
  }, [memory.x, memory.y, dragging, x, y]);

  useEffect(() => {
    rot.set(memory.rotation);
    setLiveRot(memory.rotation);
  }, [memory.rotation, rot]);

  useEffect(() => {
    scale.set(memory.scale);
    setLiveScale(memory.scale);
  }, [memory.scale, scale]);

  /* counter-scale variable so handles keep a constant on-screen size ------ */
  useEffect(() => {
    const el = scaleLayerRef.current;
    if (!el) return;
    const apply = (v: number) => el.style.setProperty('--inv-item', String(1 / v));
    apply(scale.get());
    return scale.on('change', apply);
  }, [scale]);

  useEffect(() => registerItemNode(memory.id, scaleLayerRef.current), [memory.id]);

  /* the object's own rendered size, frame chrome included ---------------- */
  const [natural, setNatural] = useState({ w: memory.w, h: memory.h });
  useLayoutEffect(() => {
    const el = scaleLayerRef.current;
    if (!el) return;
    // offsetWidth/Height ignore transforms, so this is the unscaled box
    const read = () =>
      setNatural((prev) =>
        el.offsetWidth && (prev.w !== el.offsetWidth || prev.h !== el.offsetHeight)
          ? { w: el.offsetWidth, h: el.offsetHeight }
          : prev,
      );
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ------------------------------------------------------------- dragging */
  const gesture = useRef({
    mode: 'none' as 'none' | 'move' | 'press' | 'resize' | 'rotate',
    px: 0,
    py: 0,
    ox: 0,
    oy: 0,
    moved: false,
    bx: 0,
    by: 0,
    startScale: 1,
    startRot: 0,
    startDist: 1,
    startAngle: 0,
    cx: 0,
    cy: 0,
    pointerId: -1,
  });

  const centerOnScreen = () => {
    const box = scaleLayerRef.current?.getBoundingClientRect();
    if (!box) return { cx: 0, cy: 0 };
    return { cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
  };

  /**
   * The only feedback a lock needs.
   *
   * Nothing happening is ambiguous — a dropped gesture, a slow frame, the
   * wrong element under the pointer. A degree and a half of give and then
   * straight back says the paper is there, felt that, and is staying where it
   * is, in about the time it takes to notice.
   */
  const resist = () => {
    if (prefersStillness()) return;
    const base = memory.rotation;
    void animate(rot, [base, base - 1.4, base + 1.4, base], {
      duration: 0.26,
      ease: 'easeInOut',
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button === 2) return;
    const g = gesture.current;
    /* A locked item still takes the pointer — it has to, or the press would
       fall through to the room behind it and swing the camera. It just has
       nowhere to go with it. */
    g.mode = locked ? 'press' : 'move';
    g.px = e.clientX;
    g.py = e.clientY;
    const start = toBoard(e.clientX, e.clientY);
    g.bx = start.x;
    g.by = start.y;
    g.ox = x.get();
    g.oy = y.get();
    g.moved = false;
    g.pointerId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
    if (locked) return;
    setZBoost(9999);
    setDragging(true);
    animate(lift, 1.045, LIFT);
  };

  const startHandle = (e: React.PointerEvent, mode: 'resize' | 'rotate') => {
    e.stopPropagation();
    const g = gesture.current;
    const { cx, cy } = centerOnScreen();
    g.mode = mode;
    g.cx = cx;
    g.cy = cy;
    g.px = e.clientX;
    g.py = e.clientY;
    g.startScale = scale.get();
    g.startRot = rot.get();
    g.startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    g.startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    g.pointerId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setZBoost(9999);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.mode === 'none' || e.pointerId !== g.pointerId) return;

    if (g.mode === 'press') {
      // once, on the way past the threshold — not on every frame of a shove
      if (!g.moved && Math.hypot(e.clientX - g.px, e.clientY - g.py) > 4) {
        g.moved = true;
        resist();
      }
      return;
    }

    if (g.mode === 'move') {
      // Board deltas rather than screen deltas over a zoom factor: with the
      // room turned on its axes the two are no longer the same thing, and the
      // photo has to stay under the finger that picked it up.
      const now = toBoard(e.clientX, e.clientY);
      if (!g.moved && Math.hypot(e.clientX - g.px, e.clientY - g.py) > 4) g.moved = true;
      x.set(clamp(g.ox + now.x - g.bx, -60, BOARD_W - 60));
      y.set(clamp(g.oy + now.y - g.by, -40, BOARD_H - 60));
      return;
    }

    if (g.mode === 'resize') {
      const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
      const next = clamp((dist / g.startDist) * g.startScale, MIN_SCALE, MAX_SCALE);
      scale.set(next);
      setLiveScale(next);
      return;
    }

    const angle = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
    let next = g.startRot + ((angle - g.startAngle) * 180) / Math.PI;
    if (Math.abs(next % 90) < 2.5) next = Math.round(next / 90) * 90; // gentle snap to square
    rot.set(next);
    setLiveRot(next);
  };

  const endGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.mode === 'none') return;
    const mode = g.mode;
    g.mode = 'none';
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }

    if (mode === 'press') {
      /* A press that went nowhere is a click and opens the memory. One that
         tried to drag it is not — it was aimed at moving the thing, and
         answering it with a card in the middle of the screen would be the
         second surprise in a row. */
      select(memory.id);
      if (!g.moved) open(memory.id);
      return;
    }

    if (mode === 'move') {
      setDragging(false);
      animate(lift, hovered ? 1.012 : 1, LIFT);

      if (!g.moved) {
        // a click, not a drag
        select(memory.id);
        open(memory.id);
        setZBoost(null);
        return;
      }

      // settle: the paper drops, nudging its angle a touch
      const nextRot = memory.rotation + rand(-0.9, 0.9);
      animate(rot, nextRot, SETTLE);
      scale.set(memory.scale * 1.02);
      animate(scale, memory.scale, SETTLE);
      setLiveRot(nextRot);
      const z = bringToFront(memory.id);
      updateMemory(memory.id, {
        x: Math.round(x.get()),
        y: Math.round(y.get()),
        rotation: Number(nextRot.toFixed(2)),
        zIndex: z,
      });
      select(memory.id);
      setZBoost(null);
      return;
    }

    if (mode === 'resize') {
      updateMemory(memory.id, { scale: Number(scale.get().toFixed(3)) });
    } else {
      updateMemory(memory.id, { rotation: Number(rot.get().toFixed(2)) });
    }
    setZBoost(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive) return;
    const step = e.shiftKey ? 32 : 8;
    const patch: Partial<Memory> = {};
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        open(memory.id);
        return;
      case 'l':
      case 'L':
        e.preventDefault();
        toggleLock(memory.id);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        /* Locking is for the accidents, and a stray delete on a selected
           photograph is the worst of them. The toast carries the way out, so
           this costs one keystroke rather than a trip to the card. */
        if (locked) {
          resist();
          toast('That one is locked', 'Unlock', () => toggleLock(memory.id));
          return;
        }
        deleteMemory(memory.id);
        return;
      case 'ArrowLeft':
        patch.x = memory.x - step;
        break;
      case 'ArrowRight':
        patch.x = memory.x + step;
        break;
      case 'ArrowUp':
        patch.y = memory.y - step;
        break;
      case 'ArrowDown':
        patch.y = memory.y + step;
        break;
      case '[':
        patch.rotation = memory.rotation - 2;
        break;
      case ']':
        patch.rotation = memory.rotation + 2;
        break;
      default:
        return;
    }
    e.preventDefault();
    select(memory.id);
    // everything that reaches here moves it, which is the one thing it won't do
    if (locked) {
      resist();
      return;
    }
    updateMemory(memory.id, patch);
  };

  /* The lift under the pointer is the board's way of saying "you can pick
     this up". A locked one cannot be, so it stays down and says so with the
     badge instead. */
  const hoverIn = useCallback(() => {
    setHovered(true);
    if (!dragging && !locked) animate(lift, 1.012, LIFT);
  }, [dragging, locked, lift]);

  const hoverOut = useCallback(() => {
    setHovered(false);
    if (!dragging && !locked) animate(lift, 1, LIFT);
  }, [dragging, locked, lift]);

  /* ------------------------------------------------------------ entrance */
  const fresh = Date.now() - memory.createdAt < 1400;
  const entrance = fresh
    ? { opacity: 0, y: -110, scale: 1.28, rotate: -6 }
    : { opacity: 0, y: 10, scale: 0.97, rotate: 0 };
  // uploads are already staggered as they are created, so they land immediately
  const entranceDelay = fresh ? 0 : Math.min(index * 0.022, 0.5);

  // a locked item doesn't rise off the cork under the pointer, shadow included
  const shadowClass = dragging
    ? 'item-shadow-drag'
    : (hovered && !locked) || selected
      ? 'item-shadow-hover'
      : 'item-shadow';

  /**
   * The visual box of the object, in the tilt layer's coordinates.
   *
   * `memory.w/h` is only the image area — every frame adds its own chrome
   * around it (a polaroid's chin, a mount's padding), so the rendered element
   * is measured rather than assumed. And because it scales from its centre,
   * the visible box shifts inward as it shrinks; anchoring chrome at 0,0 is
   * what left the outline and handles floating away from the photo.
   */
  const boxW = natural.w * liveScale;
  const boxH = natural.h * liveScale;
  const boxX = (natural.w - boxW) / 2;
  const boxY = (natural.h - boxH) / 2;

  return (
    <motion.div
      ref={nodeRef}
      className="absolute left-0 top-0 no-select"
      style={{
        x,
        y,
        zIndex: zBoost ?? memory.zIndex,
        opacity: isOpen ? 0 : dimmed ? 0.22 : 1,
        filter: dimmed ? 'saturate(0.5)' : undefined,
        transition: 'opacity 320ms cubic-bezier(0.22,1,0.36,1), filter 320ms cubic-bezier(0.22,1,0.36,1)',
        // While it's moving, give the item its own compositor layer: otherwise
        // every frame repaints the cork underneath it. Dropped again on release
        // so a full board isn't holding dozens of layers.
        willChange: dragging ? 'transform' : undefined,
      }}
      data-memory-id={memory.id}
    >
      <motion.div
        initial={entrance}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
        transition={{
          type: 'spring',
          stiffness: fresh ? 260 : 320,
          damping: fresh ? 18 : 26,
          mass: fresh ? 0.9 : 0.6,
          delay: entranceDelay,
        }}
      >
        <motion.div style={{ rotate: rot }} className="relative">
          {/* the object itself */}
          <motion.div
            ref={scaleLayerRef}
            role="button"
            tabIndex={interactive ? 0 : -1}
            aria-label={memory.title || memory.caption || `${memory.type} memory`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onPointerEnter={hoverIn}
            onPointerLeave={hoverOut}
            onKeyDown={onKeyDown}
            className={`relative origin-center ${shadowClass} ${
              dragging ? 'grabbing' : locked ? 'cursor-pointer' : 'cursor-grab'
            }`}
            style={{
              scale: combinedScale,
              touchAction: 'none',
              // easing the shadow is for hover; during a drag it would
              // re-rasterise a large blur on every frame of the pick-up
              transition: dragging ? 'none' : 'filter 240ms cubic-bezier(0.22,1,0.36,1)',
            }}
          >
            <MemoryObject memory={memory} />

            {memory.favorite && (
              <span
                className="pointer-events-none absolute -bottom-[7px] -right-[6px] text-[15px] leading-none"
                style={{ color: '#bd4f3c', filter: 'drop-shadow(0 1px 1px rgba(70,40,20,0.45))' }}
                aria-label="Favourite"
              >
                ♥
              </span>
            )}
          </motion.div>

          {/* pin — pushed through the paper, standing upright */}
          {memory.pinStyle !== 'none' && (
            <div
              className="pointer-events-none absolute left-1/2"
              style={{
                top: boxY,
                transform: `translate(-50%, ${memory.pinStyle === 'tape' ? '-52%' : '-58%'}) rotate(${-liveRot}deg)`,
                zIndex: 5,
              }}
            >
              {memory.pinStyle === 'tape' ? (
                <div style={{ transform: `rotate(${(index % 2 ? 1 : -1) * 3}deg)` }}>
                  <Tape width={Math.min(96, Math.max(56, boxW * 0.34))} />
                </div>
              ) : (
                <span
                  className="pointer-events-auto block cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setPinPressed(true);
                    window.setTimeout(() => setPinPressed(false), 260);
                  }}
                >
                  <Pin style={memory.pinStyle} pressed={pinPressed} />
                </span>
              )}
            </div>
          )}

          {/* selection chrome */}
          {selected && interactive && !dragging && (
            <div
              className="pointer-events-none absolute"
              style={{ left: boxX, top: boxY, width: boxW, height: boxH }}
            >
              <div
                className="absolute"
                style={{
                  inset: -7,
                  /* Marching ants around something about to move; an unbroken
                     line around something held. Two states nobody has to be
                     told apart. */
                  border: locked
                    ? '1px solid rgba(214,231,243,0.92)'
                    : '1px dashed rgba(255,250,240,0.85)',
                  boxShadow: '0 0 0 1px rgba(60,36,14,0.28)',
                  borderRadius: 3,
                }}
              />
              {!locked && (
                <>
                  <Handle
                    label="Resize"
                    position={{ left: boxW, top: boxH }}
                    onPointerDown={(e) => startHandle(e, 'resize')}
                    onPointerMove={onPointerMove}
                    onPointerUp={endGesture}
                  >
                    <path d="M4 11 L11 4 M7.5 12 L12 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </Handle>
                  <Handle
                    label="Rotate"
                    position={{ left: boxW, top: 0 }}
                    onPointerDown={(e) => startHandle(e, 'rotate')}
                    onPointerMove={onPointerMove}
                    onPointerUp={endGesture}
                  >
                    <path
                      d="M11.4 6.2 A4.6 4.6 0 1 1 8 4.2"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path d="M8 1.6 L8 5 L11 4.4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </Handle>
                </>
              )}
            </div>
          )}

          {/* Where the rotate handle would have been, which is the point: the
              corner you reach for to move it is the corner that tells you it
              won't. Only under the pointer or when selected — a board of
              locked photographs should look like a board, not like a lock
              collection. */}
          {locked && interactive && (hovered || selected) && (
            <div
              className="pointer-events-none absolute"
              style={{ left: boxX + boxW, top: boxY, zIndex: 6 }}
            >
              <span
                className="grid h-[24px] w-[24px] place-items-center rounded-full"
                style={{
                  transform: `translate(-50%,-50%) rotate(${-liveRot}deg) scale(var(--inv-zoom, 1))`,
                  background: 'linear-gradient(170deg,#fffdf7,#f1eadb)',
                  border: '1px solid rgba(95,127,153,0.42)',
                  color: HELD,
                  boxShadow: '0 2px 5px rgba(60,36,14,0.32)',
                }}
                aria-hidden="true"
              >
                <svg width="12.5" height="12.5" viewBox="0 0 16 16" fill="none">
                  <Padlock />
                </svg>
              </span>
            </div>
          )}
        </motion.div>

        {/* upright quick actions */}
        {selected && interactive && !dragging && (
          <div
            className="absolute origin-top-left"
            style={{ left: boxX, top: boxY + boxH + 18, transform: 'scale(var(--inv-zoom, 1))' }}
          >
            <div className="panel flex items-center gap-[2px] rounded-full p-[3px]" style={{ width: 'max-content' }}>
              <QuickAction label="Open" onClick={() => open(memory.id)}>
                <path d="M3 8.5V3h5.5M13 7.5V13H7.5M13 3l-4.6 4.6M3 13l4.6-4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </QuickAction>
              <QuickAction
                label={memory.favorite ? 'Unfavourite' : 'Favourite'}
                active={memory.favorite}
                onClick={() => toggleFavorite(memory.id)}
              >
                <path
                  d="M8 13.2S2.6 10 2.6 6.3A2.9 2.9 0 0 1 8 4.7a2.9 2.9 0 0 1 5.4 1.6c0 3.7-5.4 6.9-5.4 6.9z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  fill={memory.favorite ? 'currentColor' : 'none'}
                  strokeLinejoin="round"
                />
              </QuickAction>
              <QuickAction
                label={locked ? 'Unlock' : 'Lock in place'}
                active={locked}
                activeColor={HELD}
                onClick={() => toggleLock(memory.id)}
              >
                <Padlock open={!locked} />
              </QuickAction>
              <QuickAction label="Remove" danger onClick={() => deleteMemory(memory.id)}>
                <path d="M3.4 4.6h9.2M6.4 4.6V3.2h3.2v1.4M5 4.6l.6 8h4.8l.6-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </QuickAction>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Handle({
  label,
  position,
  children,
  ...handlers
}: {
  label: string;
  position: { left: number; top: number };
  children: React.ReactNode;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  return (
    <button
      {...handlers}
      onPointerCancel={handlers.onPointerUp}
      aria-label={label}
      title={label}
      className="pointer-events-auto absolute grid h-[26px] w-[26px] place-items-center rounded-full border border-[rgba(120,92,62,0.3)] bg-[linear-gradient(170deg,#fffdf7,#f2ead9)] text-[#6b5a45] shadow-[0_2px_6px_rgba(60,36,14,0.35)] transition-transform hover:text-[#3a2f22]"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%,-50%) scale(calc(var(--inv-zoom, 1) * var(--inv-item, 1)))',
        touchAction: 'none',
        cursor: label === 'Rotate' ? 'grab' : 'nwse-resize',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

/**
 * The shackle swings; the body doesn't.
 *
 * One shape changing state rather than two icons swapping places — which is
 * what makes the toggle legible at sixteen pixels, and why the badge on the
 * board and the button under it can be the same drawing.
 */
function Padlock({ open = false }: { open?: boolean }) {
  return (
    <>
      <path
        d={open ? 'M5.3 7.1V5.3a2.75 2.75 0 0 1 5.4-.75' : 'M5.3 7.1V5.3a2.7 2.7 0 0 1 5.4 0v1.8'}
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        fill="none"
      />
      <rect
        x="3.5"
        y="7.1"
        width="9"
        height="5.8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.45"
        fill="none"
      />
    </>
  );
}

function QuickAction({
  label,
  children,
  onClick,
  active,
  activeColor = '#bd4f3c',
  danger,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  /** Favourite is brick; held is not. */
  activeColor?: string;
  danger?: boolean;
}) {
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-[30px] w-[30px] place-items-center rounded-full transition-colors ${
        active
          ? ''
          : danger
            ? 'text-[#8a7466] hover:bg-[rgba(189,79,60,0.12)] hover:text-[#a83f2c]'
            : 'text-[#6b5a45] hover:bg-[rgba(120,92,62,0.12)] hover:text-[#2f2419]'
      }`}
      style={active ? { color: activeColor } : undefined}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

/**
 * Only the item that actually changed should re-render. Without this, letting
 * go of one photo re-renders every frame, pin and paper object on the board.
 */
export const BoardItem = memo(BoardItemBase);
