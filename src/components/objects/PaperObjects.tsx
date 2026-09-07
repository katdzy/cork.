import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Memory, StickyColor } from '../../lib/types';
import { formatDate, hashNoise } from '../../lib/utils';

/**
 * Text sized to the space it's given: it shrinks to stay on one line, and only
 * wraps once shrinking further would make it unreadable. A ticket or a label
 * *is* its text — clipping it to an ellipsis hides the memory itself.
 */
function FitText({
  text,
  max,
  min,
  maxHeight,
  className,
  style,
}: {
  text: string;
  max: number;
  min: number;
  maxHeight?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState({ size: max, wrap: false });

  useLayoutEffect(() => {
    const box = boxRef.current;
    const span = spanRef.current;
    if (!box || !span) return;

    const measure = () => {
      const avail = box.clientWidth;
      if (!avail) return;

      span.style.whiteSpace = 'nowrap';
      span.style.fontSize = `${max}px`;
      const needed = span.scrollWidth;
      const oneLine = needed > avail ? (max * avail) / needed : max;

      if (oneLine >= min) {
        const size = Math.floor(oneLine * 10) / 10;
        span.style.fontSize = `${size}px`;
        setFit({ size, wrap: false });
        return;
      }

      // too long to shrink gracefully — wrap it, then fit the height
      span.style.whiteSpace = 'normal';
      let size = min;
      span.style.fontSize = `${size}px`;
      const limit = (maxHeight ?? Infinity) - 2;
      let guard = 0;
      while (span.scrollHeight > limit && size > 8 && guard++ < 30) {
        size -= 0.5;
        span.style.fontSize = `${size}px`;
      }
      setFit({ size, wrap: true });
    };

    measure();
    // the web font changes every metric, so measure again once it has landed
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
    };
  }, [text, max, min, maxHeight]);

  return (
    // the couple of px of padding keep descenders off the clipping edge:
    // a tight line-height lets ink spill past the line box
    <div
      ref={boxRef}
      className="w-full"
      style={{ maxHeight, overflow: 'hidden', paddingBottom: 2 }}
    >
      <span
        ref={spanRef}
        className={className}
        style={{
          ...style,
          display: 'block',
          fontSize: fit.size,
          whiteSpace: fit.wrap ? 'normal' : 'nowrap',
          lineHeight: fit.wrap ? 1.22 : 1.16,
        }}
      >
        {text}
      </span>
    </div>
  );
}

export const STICKY_COLORS: { id: StickyColor; label: string; swatch: string }[] = [
  { id: 'butter', label: 'Butter', swatch: '#f2d987' },
  { id: 'blush', label: 'Blush', swatch: '#efc0bd' },
  { id: 'sage', label: 'Sage', swatch: '#c3cfb4' },
  { id: 'dust', label: 'Dust', swatch: '#b9cbd8' },
  { id: 'paper', label: 'Paper', swatch: '#f2ead9' },
];

const STICKY_TONES: Record<StickyColor, { top: string; bottom: string; edge: string; ink: string }> =
  {
    butter: { top: '#f8e6a4', bottom: '#eecf72', edge: '#d9b653', ink: '#5a4718' },
    blush: { top: '#f6cfcc', bottom: '#e5aeaa', edge: '#cf9490', ink: '#5c322f' },
    sage: { top: '#d5dfc6', bottom: '#bcc9a8', edge: '#a4b48d', ink: '#3a442d' },
    dust: { top: '#cfdde6', bottom: '#b0c4d2', edge: '#96adbd', ink: '#2c3f4c' },
    paper: { top: '#faf3e2', bottom: '#ece1c9', edge: '#d5c8ab', ink: '#3f362a' },
  };

/* ------------------------------------------------------------- sticky note */
export function StickyNote({ memory, width, height }: { memory: Memory; width: number; height: number }) {
  const tone = STICKY_TONES[memory.color ?? 'butter'];
  const lines = (memory.text || 'remember this day :)').split('\n');
  const size = Math.min(width, height);

  return (
    <div
      className="paper-tex relative"
      style={{
        width,
        height,
        background: `linear-gradient(163deg, ${tone.top} 0%, ${tone.bottom} 88%)`,
        boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.05), inset 0 -14px 22px -18px rgba(0,0,0,0.35)`,
      }}
    >
      {/* the adhesive strip catches light differently */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ height: '22%', background: 'linear-gradient(180deg, rgba(255,255,255,0.34), rgba(255,255,255,0))' }}
      />
      <div
        className="flex h-full w-full flex-col items-center justify-center px-[10%] text-center"
        style={{ color: tone.ink }}
      >
        {lines.map((line, i) => (
          <span key={i} className="hand leading-[1.18]" style={{ fontSize: size * 0.135 }}>
            {line || ' '}
          </span>
        ))}
      </div>
      {/* peeled corner */}
      <div
        className="pointer-events-none absolute bottom-0 right-0"
        style={{
          width: size * 0.2,
          height: size * 0.2,
          background: `linear-gradient(315deg, ${tone.edge} 0%, ${tone.bottom} 44%, transparent 46%)`,
          filter: 'drop-shadow(-2px -2px 3px rgba(60,40,16,0.22))',
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------- handwritten note */
export function HandNote({ memory, width, height }: { memory: Memory; width: number; height: number }) {
  const lines = (memory.text || 'a little note').split('\n');
  const fs = Math.min(height / (lines.length + 1.1), width * 0.13);

  return (
    <div
      className="paper-tex relative flex flex-col items-center justify-center"
      style={{
        width,
        height,
        background: 'linear-gradient(168deg,#fffdf4 0%,#f7f0dd 100%)',
        borderRadius: 2,
        boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.10)',
        clipPath: `polygon(0% 2%, 12% 0%, 34% 2%, 58% 0%, 82% 2%, 100% 0%, 100% 98%, 74% 100%, 46% 98%, 22% 100%, 0% 98%)`,
      }}
    >
      {/* faint rule lines, like a torn notebook page */}
      <div
        className="pointer-events-none absolute inset-x-[7%] inset-y-0"
        style={{
          backgroundImage: 'repeating-linear-gradient(180deg, transparent 0 27px, rgba(120,140,160,0.16) 27px 28px)',
        }}
      />
      <div className="relative flex flex-col items-center px-[8%] text-center text-[#3b3229]">
        {lines.map((line, i) => (
          <span key={i} className="hand leading-[1.24]" style={{ fontSize: fs }}>
            {line || ' '}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ticket */
export function Ticket({ memory, width, height }: { memory: Memory; width: number; height: number }) {
  const stub = Math.round(width * 0.24);
  const notch = Math.max(6, height * 0.06);
  const serial = 100 + Math.round(hashNoise(memory.id) * 899);

  return (
    <div
      className="relative"
      style={{
        width,
        height,
        filter: 'drop-shadow(0 1px 0 rgba(120,92,62,0.18))',
      }}
    >
      <div
        className="paper-tex relative h-full w-full overflow-hidden"
        style={{
          background: 'linear-gradient(166deg,#fdf5e2 0%,#f3e6c9 100%)',
          borderRadius: 3,
          maskImage: `radial-gradient(circle ${notch}px at ${width - stub}px 0, transparent ${notch}px, #000 ${notch + 0.5}px), radial-gradient(circle ${notch}px at ${width - stub}px ${height}px, transparent ${notch}px, #000 ${notch + 0.5}px)`,
          maskComposite: 'intersect',
          WebkitMaskImage: `radial-gradient(circle ${notch}px at ${width - stub}px 0, transparent ${notch}px, #000 ${notch + 0.5}px), radial-gradient(circle ${notch}px at ${width - stub}px ${height}px, transparent ${notch}px, #000 ${notch + 0.5}px)`,
          WebkitMaskComposite: 'source-in',
        }}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: 7, background: 'linear-gradient(180deg,#c05340,#8f3627)' }}
        />
        {/* perforation */}
        <div
          className="absolute inset-y-2"
          style={{
            left: width - stub,
            width: 1,
            backgroundImage: 'repeating-linear-gradient(180deg, rgba(120,92,62,0.42) 0 4px, transparent 4px 9px)',
          }}
        />

        <div className="absolute inset-y-0 left-0 flex flex-col justify-center" style={{ paddingLeft: 20, width: width - stub - 14 }}>
          <span className="mono text-[8px] font-bold tracking-[0.28em] text-[#a8815a]">ADMIT ONE</span>
          {/* shrink-0: the column would otherwise squeeze a wrapped title and
              clip its last line */}
          <div className="mt-[3px] shrink-0">
            <FitText
              text={memory.text || memory.title || 'CONCERT'}
              max={Math.min(26, height * 0.24)}
              min={13}
              maxHeight={height * 0.46}
              className="font-extrabold tracking-[-0.01em] text-[#2f2419]"
            />
          </div>
          <div className="mono mt-[5px] flex flex-wrap items-center gap-x-2 text-[9px] leading-[1.5] tracking-[0.1em] text-[#6c5a45]">
            {memory.date && <span>{memory.date.replaceAll('-', '.')}</span>}
            {memory.date && memory.location && <span className="text-[#bda98c]">•</span>}
            {memory.location && <span className="uppercase">{memory.location}</span>}
          </div>
        </div>

        <div
          className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-[6px]"
          style={{ width: stub - 14 }}
        >
          <div className="flex h-[38%] items-end gap-[2px]">
            {Array.from({ length: 11 }, (_, i) => (
              <span
                key={i}
                style={{
                  width: hashNoise(memory.id, i) > 0.6 ? 3 : 1.5,
                  height: '100%',
                  background: '#3a2f22',
                  opacity: 0.78,
                }}
              />
            ))}
          </div>
          <span className="mono text-[8px] tracking-[0.14em] text-[#6c5a45]">№{serial}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- label */
export function LabelTag({ memory, width, height }: { memory: Memory; width: number; height: number }) {
  return (
    <div
      className="paper-tex relative flex items-center justify-center"
      style={{
        width,
        height,
        background: 'linear-gradient(168deg,#f6ecd6,#e6d7b6)',
        borderRadius: 4,
        boxShadow: 'inset 0 0 0 1px rgba(140,110,70,0.22), inset 0 1px 0 rgba(255,255,255,0.6)',
      }}
    >
      <span
        className="absolute left-[9px] top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-full"
        style={{ background: '#c9b795', boxShadow: 'inset 0 1px 2px rgba(80,58,28,0.55)' }}
      />
      <div style={{ paddingLeft: 24, paddingRight: 10, width: '100%' }}>
        <FitText
          text={memory.text || memory.title || 'LABEL'}
          max={Math.min(15, height * 0.28)}
          min={8}
          maxHeight={height * 0.74}
          className="font-bold uppercase tracking-[0.2em] text-[#5b4a30]"
          style={{ textAlign: 'center' }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- postcard */
export function Postcard({
  memory,
  src,
  width,
  height,
}: {
  memory: Memory;
  src?: string;
  width: number;
  height: number;
}) {
  const lines = (memory.text || memory.caption || '').split('\n').slice(0, 4);

  return (
    <div
      className="paper-tex relative overflow-hidden"
      style={{
        width,
        height,
        background: 'linear-gradient(166deg,#fdf8ea,#f0e6cd)',
        borderRadius: 3,
        boxShadow: 'inset 0 0 0 1px rgba(140,110,70,0.2)',
        padding: height * 0.045,
      }}
    >
      <div className="flex h-full w-full gap-[4%]">
        <div className="relative h-full" style={{ width: '48%' }}>
          {src ? (
            <img
              src={src}
              alt={memory.title || 'Postcard'}
              draggable={false}
              className="h-full w-full object-cover"
              style={{ borderRadius: 2, filter: 'saturate(1.05) contrast(1.02)' }}
            />
          ) : (
            <div className="h-full w-full bg-[#ded1b6]" style={{ borderRadius: 2 }} />
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              borderRadius: 2,
              background: 'linear-gradient(150deg, rgba(255,255,255,0.2), rgba(60,38,16,0.1))',
              boxShadow: 'inset 0 0 0 1px rgba(80,58,28,0.22)',
            }}
          />
        </div>

        <div className="relative flex h-full flex-1 flex-col">
          {/* stamp */}
          <div className="flex items-start justify-between">
            <span className="mono text-[7px] font-bold tracking-[0.2em] text-[#a8916c]">
              POST CARD
            </span>
            <div
              className="relative"
              style={{
                width: width * 0.115,
                height: width * 0.14,
                background: 'linear-gradient(150deg,#e8dcc0,#d9c8a2)',
                maskImage:
                  'radial-gradient(circle 2px at 0 0, transparent 2px, #000 2px), radial-gradient(circle 2px at 100% 100%, transparent 2px, #000 2px)',
                boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.3)',
              }}
            >
              <div
                className="absolute inset-[3px]"
                style={{ background: 'linear-gradient(160deg,#c4826c,#8f5a52)' }}
              />
              <div
                className="absolute inset-[3px]"
                style={{
                  background:
                    'radial-gradient(circle at 50% 70%, rgba(255,230,190,0.5), transparent 60%)',
                }}
              />
            </div>
          </div>

          <div className="mt-[6%] flex-1">
            {lines.map((line, i) => (
              <div
                key={i}
                className="hand leading-[1.28] text-[#4a3d31]"
                style={{ fontSize: Math.max(12, width * 0.046) }}
              >
                {line}
              </div>
            ))}
          </div>

          <div
            className="mt-auto space-y-[5px] pt-[4%]"
            style={{ borderTop: '1px solid rgba(140,110,70,0.22)' }}
          >
            {[86, 70].map((w, i) => (
              <div
                key={i}
                style={{ width: `${w}%`, height: 1, background: 'rgba(140,110,70,0.28)' }}
              />
            ))}
          </div>

          {memory.date && (
            <span
              className="hand absolute right-0 top-[42%] text-[#6b5a48]"
              style={{ fontSize: Math.max(11, width * 0.038) }}
            >
              {formatDate(memory.date)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
