import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * A stick for the thumb that has nowhere else to go.
 *
 * On a laptop you look around this room by dragging it, and there is always
 * somewhere to start that drag: plaster, counter, the wall beside the board.
 * Held upright on a phone the room is a metre of wall seen through a letterbox
 * — the board and what is pinned to it are most of what is on screen, and a
 * drag that starts on a photograph moves the photograph. The gesture is still
 * there; the room it needs is not.
 *
 * So the same gesture gets a fixed place to live, down in the corner with the
 * rest of the camera's controls, where a thumb can find it without looking and
 * where it cannot land on anything that would rather be dragged itself.
 *
 * It moves you, not the room — push it right and you walk right around the
 * counter, push it up and you stand taller. That is the opposite sign to the
 * drag, and deliberately so: a stick under your thumb reads as *you*, and a
 * thing you push that sends you the other way is a thing you fight. The scene
 * does the negating; what leaves here is simply the direction it is pointed
 * and how hard, as two numbers between −1 and 1.
 *
 * Nothing is timed here either. A held control is a speed rather than a
 * distance, and the frame loop is the only part of this that owns a clock.
 */

const PAD = 100;
const KNOB = 42;
/** How far the knob leaves the middle at full tilt — and so, the input range. */
const TRAVEL = 24;
/** A thumb resting on the stick is not asking for anything. */
const DEAD = 0.14;

/**
 * How hard a push of a given length counts as.
 *
 * Not linear: near the middle you are lining something up and want a degree
 * at a time, at the rim you are crossing the room. But not squared either,
 * which is the usual answer and makes the first half of the throw feel dead —
 * this keeps about a quarter of the rate at half tilt, slow enough to aim
 * with and fast enough to feel connected.
 */
const respond = (m: number) => {
  if (m <= DEAD) return 0;
  const t = Math.min(1, (m - DEAD) / (1 - DEAD));
  return t * (0.4 + 0.6 * t);
};

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Props {
  /** Direction and how hard, each −1..1. Zeroes the moment the thumb lifts. */
  onMove(x: number, y: number): void;
  /** Lifted clear of the results shelf, like everything else in this corner. */
  raised?: boolean;
}

export function Joystick({ onMove, raised }: Props) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const keys = useRef(new Set<string>());
  const [gripped, setGripped] = useState(false);

  /* Whatever happens to this control — the cork view, a room swap, an unmount
     mid-push — the camera must not be left drifting. The ref keeps the latest
     callback without making the cleanup run on every render. */
  const latest = useRef(onMove);
  latest.current = onMove;
  useEffect(() => () => latest.current(0, 0), []);

  /**
   * Put the knob somewhere.
   *
   * Written straight to the node rather than through state: this runs on every
   * pointer move, and a React render here is a render of the whole board
   * beneath it. The transition is set alongside the transform for the same
   * reason — it has to be off while tracking and on for the spring home, and
   * that is one property, not a piece of state to keep in step.
   */
  const place = (x: number, y: number, ease = false) => {
    const knob = knobRef.current;
    if (!knob) return;
    knob.style.transition = ease ? 'transform 300ms var(--ease-out-soft)' : 'none';
    knob.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const drive = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const box = pad.getBoundingClientRect();
    const dx = clientX - (box.left + box.width / 2);
    const dy = clientY - (box.top + box.height / 2);
    const dist = Math.hypot(dx, dy);
    // the knob stops at the rim; the thumb is welcome to carry on past it
    const mag = Math.min(1, dist / TRAVEL);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    place(ux * mag * TRAVEL, uy * mag * TRAVEL);
    const r = respond(mag);
    onMove(ux * r, uy * r);
  };

  const letGo = () => {
    pointer.current = null;
    setGripped(false);
    place(0, 0, true);
    onMove(0, 0);
  };

  /* Arrows drive the same stick at full tilt — there is no half-pressing a
     key, and a discrete input pretending to be an analogue one is worse than
     an honest one. Diagonals are normalised so two keys are not faster than
     one in a direction neither of them points. */
  const fromKeys = () => {
    let x = 0;
    let y = 0;
    for (const key of keys.current) {
      const [kx, ky] = ARROWS[key];
      x += kx;
      y += ky;
    }
    const d = Math.hypot(x, y);
    if (!d) {
      place(0, 0, true);
      onMove(0, 0);
      setGripped(false);
      return;
    }
    place((x / d) * TRAVEL, (y / d) * TRAVEL, true);
    onMove(x / d, y / d);
    setGripped(true);
  };

  return (
    <motion.div
      /* The same handle every floating control carries: the room's own pointer
         handlers step over anything wearing it, so a thumb on the stick never
         also starts a drag on the wall behind it — or, with a second finger
         down somewhere else, a pinch. */
      data-board-chrome
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 430, damping: 33 }}
      className="pointer-events-auto absolute left-3 z-30 transition-[bottom] duration-300"
      style={{
        bottom: `calc(${
          raised
            ? 'calc(198px + env(safe-area-inset-bottom, 0px))'
            : 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 16px))'
        } + 52px)`,
      }}
    >
      <div
        ref={padRef}
        role="group"
        tabIndex={0}
        aria-label="Move around the room — drag the stick, or use the arrow keys"
        className="panel relative grid place-items-center"
        /* The roundness is inline because the global focus ring resets
           `border-radius` to a few pixels, and a circle that squares off the
           moment it is tabbed to is a circle nobody meant to draw. */
        style={{ width: PAD, height: PAD, borderRadius: 9999, touchAction: 'none' }}
        onPointerDown={(e) => {
          if (pointer.current !== null) return;
          pointer.current = e.pointerId;
          setGripped(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* A pointer the browser has already finished with. Capture only
               buys the thumb the right to wander off the pad mid-push; losing
               it is not a reason to abandon the push. */
          }
          drive(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointer.current !== e.pointerId) return;
          drive(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => pointer.current === e.pointerId && letGo()}
        onPointerCancel={(e) => pointer.current === e.pointerId && letGo()}
        onKeyDown={(e) => {
          if (!(e.key in ARROWS) || e.repeat) return;
          e.preventDefault();
          keys.current.add(e.key);
          fromKeys();
        }}
        onKeyUp={(e) => {
          if (!keys.current.delete(e.key)) return;
          fromKeys();
        }}
        /* Tabbing away mid-push would otherwise leave the camera turning with
           no key left to lift. */
        onBlur={() => {
          if (!keys.current.size) return;
          keys.current.clear();
          fromKeys();
        }}
      >
        {/* The well the knob sits in — a shallow dish, lit from above like
            every other surface in this room. */}
        <span
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            inset: 9,
            background:
              'radial-gradient(circle at 50% 38%, rgba(120,92,62,0.13), rgba(120,92,62,0.04) 70%)',
            boxShadow:
              'inset 0 1.5px 3px rgba(58,34,12,0.18), inset 0 -1px 0 rgba(255,255,255,0.65)',
          }}
        />

        {/* Four ticks, which is the quietest way to say "two axes, both ways"
            without writing it on the furniture. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <g stroke="rgba(120,92,62,0.34)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M50 15v5" />
            <path d="M50 80v5" />
            <path d="M15 50h5" />
            <path d="M80 50h5" />
          </g>
        </svg>

        <div
          ref={knobRef}
          aria-hidden="true"
          className="relative rounded-full"
          style={{
            width: KNOB,
            height: KNOB,
            background:
              'radial-gradient(circle at 36% 28%, #7b6a52, #443a2b 56%, #28211a)',
            /* Pressed, it sits down into the well: the same two shadows, the
               wide one shortened. Nothing else about it changes. */
            boxShadow: gripped
              ? '0 1px 1px rgba(40,24,10,0.4), 0 3px 6px -2px rgba(40,24,10,0.5), inset 0 1px 0 rgba(253,246,232,0.2), inset 0 -1px 1px rgba(20,12,4,0.3)'
              : '0 1px 1px rgba(40,24,10,0.35), 0 8px 14px -5px rgba(40,24,10,0.55), inset 0 1px 0 rgba(253,246,232,0.18), inset 0 -1px 1px rgba(20,12,4,0.3)',
          }}
        >
          {/* a turned edge, so it reads as something machined rather than a dot */}
          <span
            className="absolute rounded-full"
            style={{ inset: 5, border: '1px solid rgba(253,246,232,0.16)' }}
          />
        </div>
      </div>
    </motion.div>
  );
}
