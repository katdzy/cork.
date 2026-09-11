import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { motion } from "framer-motion";
import type { PinStyle } from "../../lib/types";
import { endTour } from "../../lib/tour";
import { Pin } from "../board/Pin";

/**
 * Being shown round, once.
 *
 * Five notes pinned to the things they are about. Anchored rather than
 * stacked in the middle, because half of what there is to say here is *where*
 * a thing is — "the next button over swaps the room" is a sentence that only
 * works if the button is lit while you read it.
 *
 * Every step names a control by a `data-tour` handle rather than by position,
 * and a step whose handle is not on screen falls back to the middle instead of
 * pointing at nothing. That matters more than it sounds: the sidebar is not
 * there on a phone, the hint line is not there on an empty board, and a tour
 * that breaks on the layout it was not written for is worse than none.
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
    eyebrow: "Welcome",
    title: "This is your corkboard.",
    pin: "red",
    body: "There is a boardful of memories pinned up already, so there is something to look at while you get your bearings. Everything you add from here lives in this browser and goes nowhere else.",
  },
  {
    eyebrow: "Pinning",
    title: "Put something up.",
    target: "add",
    pin: "blue",
    body: "Photographs, a note to yourself, a ticket stub worth keeping. You can also drop files straight onto the board, or paste an image in from anywhere.",
  },
  {
    eyebrow: "The room",
    title: "It is a room, so look around it.",
    pin: "yellow",
    body: "Drag to swing the camera, scroll to move closer. Double-click the cork itself and it takes you in on it — the board is real geometry hanging on a real wall, not a picture of one.",
  },
  {
    eyebrow: "Two ways to look",
    title: "Square on, when you mean business.",
    target: "cork",
    pin: "pastel",
    body: "This puts you flat in front of the board, where dragging slides instead of swinging and nothing can knock the camera off axis. The button beside it moves the whole board to another wall — a kitchen, or a studio.",
  },
  {
    eyebrow: "The counter",
    title: "The rest of it is yours too.",
    pin: "white",
    body: "Everything standing on the counter can be picked up and put down somewhere else, and it stays where you leave it. Rest on the laptop for a moment and you can change what colour it came in.",
  },
];

const PAD = 10;
const CARD = 340;

export function Tour() {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  /* Measured after paint and again on the next frame. The controls this points
     at are still animating in when the tour opens, and a spotlight that lands
     where a button was a moment ago is worse than one that arrives late. */
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = step.target
        ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [step.target]);

  const next = useCallback(() => {
    if (last) endTour();
    else setI((n) => n + 1);
  }, [last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);

  /* Below the target when it sits high on the screen and above it when it sits
     low, so the note never covers the thing it is pointing at. */
  const below = rect
    ? rect.top + rect.height / 2 < window.innerHeight / 2
    : false;
  const place: React.CSSProperties = rect
    ? {
        left: Math.min(
          Math.max(rect.left + rect.width / 2, CARD / 2 + 16),
          window.innerWidth - CARD / 2 - 16,
        ),
        top: below ? rect.bottom + 20 : rect.top - 20,
        transform: below ? "translateX(-50%)" : "translate(-50%, -100%)",
      }
    : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

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
      {/* The dim. One element either way: a ring around the lit control, or a
          plain sheet when there is nothing on screen to light. */}
      {rect ? (
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="pointer-events-none absolute rounded-[18px]"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow:
              "0 0 0 9999px rgba(38,22,10,0.5), 0 0 0 1.5px rgba(255,248,235,0.5)",
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "rgba(38,22,10,0.5)" }}
        />
      )}

      {/* Catches everything, so the room underneath stays still while it is
          being explained. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/*
       * Two elements, and they have to be two.
       *
       * Anchoring a note to a control is a `translate(-50%)` on top of a left
       * and a top; the entrance is a transform as well. Put both on one
       * element and the animation library owns `transform` outright — the
       * centring silently stops happening and every note hangs off to the
       * right of where it was pointing. So the outer one does the placing and
       * the inner one does the moving, and neither has an opinion about the
       * other.
       */}
      <div
        className="absolute"
        style={{ ...place, width: `min(${CARD}px, calc(100vw - 32px))` }}
      >
        <motion.div
          key={i}
          initial={{ opacity: 0, y: below ? -8 : 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="panel-solid relative rounded-[18px] px-5 pb-[18px] pt-[26px]"
        >
          <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[42%]">
            <Pin style={step.pin} size={26} />
          </span>

          <span className="eyebrow">{step.eyebrow}</span>
          <h3 className="mt-[7px] text-[17px] font-extrabold leading-[1.25] tracking-[-0.02em] text-[#241d18]">
            {step.title}
          </h3>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-[#5d4f42]">
            {step.body}
          </p>

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
                {last ? "Start pinning" : "Next"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
