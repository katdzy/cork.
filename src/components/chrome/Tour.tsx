import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { PinStyle } from '../../lib/types';
import { endTour } from '../../lib/tour';
import { Pin } from '../board/Pin';

/**
 * Being shown round, once.
 *
 * Six notes pinned to the things they are about. Anchored rather than stacked
 * in the middle, because half of what there is to say here is *where* a thing
 * is — "the button beside it swaps the room" is a sentence that only works if
 * the button is lit while you read it.
 *
 * Every step names a control by a `data-tour` handle rather than by position,
 * which is also what lets one tour serve both layouts: the boards live down
 * the left on a desktop and behind the bar at the top on a phone, and the step
 * that points at them does not need to know which. A step whose handle is not
 * on screen falls back to the middle instead of pointing at nothing.
 */

interface Step {
  eyebrow: string;
  title: string;
  body: string;
  /** The `data-tour` handle to light up, if it happens to be on screen. */
  target?: string;
  pin: PinStyle;
}

const STEPS: Step[] = [
  {
    eyebrow: 'Welcome',
    title: 'This is your corkboard.',
    pin: 'red',
    body: 'There is a boardful of memories pinned up already, so there is something to look at while you get your bearings. Everything you add from here lives in this browser and goes nowhere else.',
  },
  {
    eyebrow: 'Pinning',
    title: 'Put something up.',
    target: 'add',
    pin: 'blue',
    body: 'Photographs, a note to yourself, a ticket stub worth keeping. You can also drop files straight onto the board, or paste an image in from anywhere.',
  },
  {
    eyebrow: 'Your boards',
    title: 'More than one wall.',
    target: 'boards',
    pin: 'yellow',
    body: 'Boards, favourites and everything you have ever pinned live here, and so does Settings. Keep a board a year, or start one for a weekend.',
  },
  {
    eyebrow: 'The room',
    title: 'It is a room, so look around it.',
    pin: 'pastel',
    body: 'Drag to swing the camera, pinch or scroll to move closer. Double-click the cork itself and it takes you in on it — the board is real geometry hanging on a real wall, not a picture of one.',
  },
  {
    eyebrow: 'Two ways to look',
    title: 'Square on, when you mean business.',
    target: 'cork',
    pin: 'white',
    body: 'This puts you flat in front of the board, where dragging slides instead of swinging and nothing can knock the camera off axis. The button beside it moves the whole board to another wall — a kitchen, or a studio.',
  },
  {
    eyebrow: 'The counter',
    title: 'The rest of it is yours too.',
    pin: 'metal',
    body: 'Everything standing on the counter can be picked up and put down somewhere else, and it stays where you leave it. Rest on the laptop for a moment and you can change what colour it came in.',
  },
];

const PAD = 10;
const CARD = 340;
const DIM = 'rgba(38,22,10,0.5)';

export function Tour() {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tall, setTall] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  /* Measured after paint and again on the next frame. The controls this points
     at are still animating in when the tour opens, and a spotlight that lands
     where a button was a moment ago is worse than one that arrives late. */
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target
        ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [step.target]);

  // its own height, so it can be kept on a screen shorter than it is
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    setTall((was) => (Math.abs(was - h) > 1 ? h : was));
  }, [i, rect]);

  const next = useCallback(() => {
    if (last) endTour();
    else setI((n) => n + 1);
  }, [last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next]);

  /*
   * Placed in plain pixels, with no transform anywhere near it.
   *
   * Centring a note used to be a `translate(-50%)` on top of a left and a top,
   * and the entrance is a transform as well — one element cannot have both,
   * because the animation owns `transform` outright and the centring silently
   * stops happening. Working the left and the top out here instead means the
   * two never meet, and it is the only way to clamp: a note that would hang off
   * the bottom of a short phone gets pushed back on, rather than being half a
   * screen below the only button that dismisses it.
   */
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  const wide = Math.min(CARD, vw - 32);
  const centreX = rect ? rect.left + rect.width / 2 : vw / 2;
  const left = Math.min(Math.max(16, centreX - wide / 2), Math.max(16, vw - wide - 16));
  const below = rect ? rect.top + rect.height / 2 < vh / 2 : false;
  const wanted = rect ? (below ? rect.bottom + 20 : rect.top - 20 - tall) : (vh - tall) / 2;
  const top = Math.min(Math.max(16, wanted), Math.max(16, vh - tall - 16));

  /** The dim, as four panels around the hole rather than one vast shadow. */
  const panels: React.CSSProperties[] = rect
    ? [
        { left: 0, top: 0, width: vw, height: Math.max(0, rect.top - PAD) },
        { left: 0, top: rect.bottom + PAD, width: vw, height: Math.max(0, vh - rect.bottom - PAD) },
        { left: 0, top: rect.top - PAD, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 },
        {
          left: rect.right + PAD,
          top: rect.top - PAD,
          width: Math.max(0, vw - rect.right - PAD),
          height: rect.height + PAD * 2,
        },
      ]
    : [{ left: 0, top: 0, width: vw, height: vh }];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label="A look round Cork."
    >
      {/*
        * Four rectangles, and it matters that they are four.
        *
        * The obvious way to cut a hole in a dim is one box with a nine-thousand
        * pixel spread on its shadow, and on a desktop you would never know. On
        * a phone it is twenty thousand pixels square of shadow to rasterise,
        * composited over a live WebGL canvas, every time the hole moves — which
        * is once a step. It is the whole of the hang.
        */}
      {panels.map((p, n) => (
        <div key={n} className="pointer-events-none absolute" style={{ ...p, background: DIM }} />
      ))}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-[18px]"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: 'inset 0 0 0 1.5px rgba(255,248,235,0.45)',
          }}
        />
      )}

      {/* Catches everything, so the room underneath stays still while it is
          being explained — and never rubber-bands the page on a phone. */}
      <div className="absolute inset-0" style={{ touchAction: 'none' }} />

      <div
        ref={cardRef}
        className="absolute"
        /* Only scrolls when it genuinely cannot fit, because the pin hangs off
           the top of the note and any overflow at all would cut its head off. */
        style={{
          left,
          top,
          width: wide,
          maxHeight: vh - 32,
          overflowY: tall > vh - 32 ? 'auto' : 'visible',
        }}
      >
        <motion.div
          key={i}
          initial={{ opacity: 0, y: below ? -8 : 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="panel-solid relative rounded-[18px] px-5 pb-[18px] pt-[26px]"
        >
          <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[42%]">
            <Pin style={step.pin} size={26} />
          </span>

          <span className="eyebrow">{step.eyebrow}</span>
          <h3 className="mt-[7px] text-[17px] font-extrabold leading-[1.25] tracking-[-0.02em] text-[#241d18]">
            {step.title}
          </h3>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-[#5d4f42]">{step.body}</p>

          <div className="mt-[18px] flex items-center justify-between">
            <span className="hand text-[16px] text-[#a6968a]">
              {i + 1} of {STEPS.length}
            </span>
            <div className="flex items-center gap-1.5">
              {i > 0 && (
                <button
                  onClick={() => setI((n) => n - 1)}
                  className="rounded-full px-3 py-[7px] text-[12.5px] font-bold text-[#7d6f64] transition-colors hover:bg-[rgba(120,92,62,0.1)]"
                >
                  Back
                </button>
              )}
              <button
                onClick={endTour}
                className="rounded-full px-3 py-[7px] text-[12.5px] font-bold text-[#7d6f64] transition-colors hover:bg-[rgba(120,92,62,0.1)]"
              >
                Skip
              </button>
              <button
                onClick={next}
                className="rounded-full bg-[#c0503a] px-[15px] py-[7px] text-[12.5px] font-bold text-[#fff6ea] transition-transform duration-200 hover:-translate-y-[1px] active:translate-y-0"
              >
                {last ? 'Start pinning' : 'Next'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
