import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion } from 'framer-motion';
import type { FrameStyle, Memory, PinStyle, StickyColor } from '../../lib/types';
import { useCork } from '../../lib/store';
import { formatDate, relativeDay } from '../../lib/utils';
import { getItemRect } from '../board/itemRects';
import { MemoryObject } from '../board/MemoryObject';
import { FRAME_STYLES } from '../frames/Frame';
import { PIN_STYLES, Pin } from '../board/Pin';
import { STICKY_COLORS } from '../objects/PaperObjects';

const SPRING = { type: 'spring' as const, stiffness: 260, damping: 30, mass: 0.85 };

export function MemoryDetail({ memory, onClose }: { memory: Memory; onClose(): void }) {
  const updateMemory = useCork((s) => s.updateMemory);
  const deleteMemory = useCork((s) => s.deleteMemory);
  const toggleFavorite = useCork((s) => s.toggleFavorite);
  const board = useCork((s) => s.boards.find((b) => b.id === memory.boardId));

  const mediaRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);

  /* fit the object into the viewport, keeping its frame identity ---------- */
  const innerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ w: memory.w, h: memory.h });
  const [fit, setFit] = useState(1);

  // frames add their own chrome, so measure what the object actually is
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (el?.offsetWidth) setNatural({ w: el.offsetWidth, h: el.offsetHeight });
  }, [memory.id, memory.frameStyle, memory.w, memory.h, memory.caption, memory.text]);

  useLayoutEffect(() => {
    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const wide = vw >= 900;
      const maxW = wide ? Math.min(vw * 0.46, 640) : vw - 48;
      const maxH = wide ? vh * 0.76 : vh * 0.44;
      setFit(Math.max(0.4, Math.min(maxW / natural.w, maxH / natural.h, 2.1)));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [natural]);

  /* expand out of the board, and fall back into it on close --------------- */
  useLayoutEffect(() => {
    const node = mediaRef.current;
    const from = getItemRect(memory.id);
    if (!node || !from) return;
    const to = node.getBoundingClientRect();
    if (!to.width) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = from.width / to.width;
    void animate(
      node,
      { x: [dx, 0], y: [dy, 0], scale: [s, 1], opacity: [0.75, 1] },
      { ...SPRING, opacity: { duration: 0.18 } },
    );
  }, [memory.id]);

  const close = () => {
    if (closing) return;
    setClosing(true);
    const node = mediaRef.current;
    const from = getItemRect(memory.id);
    if (node && from) {
      const to = node.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      const s = from.width / to.width;
      void animate(
        node,
        { x: dx, y: dy, scale: s, opacity: 0.6 },
        { type: 'spring', stiffness: 320, damping: 34, mass: 0.7 },
      );
      window.setTimeout(onClose, 210);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isPaper = ['sticky', 'note', 'ticket', 'label'].includes(memory.type);
  const displayTitle = memory.title || memory.text?.split('\n')[0] || 'Untitled memory';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={displayTitle}>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: closing ? 0.2 : 0.3 }}
        onClick={close}
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        style={{
          background:
            'radial-gradient(90% 80% at 50% 40%, rgba(44,26,12,0.7), rgba(28,16,6,0.86))',
          backdropFilter: 'blur(7px)',
          WebkitBackdropFilter: 'blur(7px)',
        }}
      />

      <div className="relative flex h-full w-full max-w-[1180px] flex-col items-center gap-6 overflow-y-auto px-5 py-8 max-[899px]:justify-start min-[900px]:flex-row min-[900px]:justify-center min-[900px]:overflow-visible min-[900px]:px-8">
        {/* the object, at size */}
        <div
          ref={mediaRef}
          className="relative shrink-0 origin-center"
          style={{
            width: natural.w * fit,
            height: natural.h * fit,
            filter:
              'drop-shadow(0 20px 30px rgba(0,0,0,0.45)) drop-shadow(0 50px 70px rgba(0,0,0,0.35))',
          }}
        >
          <div
            ref={innerRef}
            className="absolute left-0 top-0 w-max"
            style={{ transform: `scale(${fit})`, transformOrigin: 'top left' }}
          >
            <MemoryObject memory={memory} />
          </div>
        </div>

        {/* the story */}
        <motion.aside
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: closing ? 0 : 1, y: closing ? 12 : 0 }}
          transition={{ delay: closing ? 0 : 0.12, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="panel-solid w-full max-w-[420px] shrink-0 rounded-[20px] p-6 min-[900px]:max-h-[80vh] min-[900px]:overflow-y-auto scroll-thin"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex items-center gap-[7px]">
              <span
                className="h-[9px] w-[9px] rounded-full"
                style={{ background: board?.accent ?? '#bd4f3c' }}
              />
              <span className="eyebrow">{board?.name ?? 'Board'}</span>
            </span>
            <span className="flex items-center gap-[6px]">
              <span className="text-[11px] text-[#a6968a]">added {relativeDay(memory.createdAt)}</span>
              <button
                onClick={close}
                aria-label="Close"
                title="Close"
                className="-mr-[7px] -mt-[6px] grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full text-[#a6968a] transition-colors hover:bg-[rgba(120,92,62,0.12)] hover:text-[#3f362a] max-[899px]:hidden"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          </div>

          {editing ? (
            <input
              value={memory.title}
              onChange={(e) => updateMemory(memory.id, { title: e.target.value })}
              placeholder="Give it a title"
              className="mt-3 w-full border-b border-[rgba(120,92,62,0.3)] bg-transparent pb-1 text-[24px] font-extrabold tracking-[-0.02em] text-[#241d18] outline-none placeholder:text-[#c0b2a4] focus:border-[#8a6a48]"
            />
          ) : (
            <h2 className="mt-3 text-[26px] font-extrabold leading-[1.12] tracking-[-0.025em] text-[#241d18]">
              {displayTitle}
            </h2>
          )}

          {editing ? (
            <input
              value={memory.caption}
              onChange={(e) => updateMemory(memory.id, { caption: e.target.value })}
              placeholder="Say something about it"
              className="hand mt-2 w-full border-b border-[rgba(120,92,62,0.22)] bg-transparent pb-1 text-[21px] text-[#5d4f42] outline-none placeholder:text-[#c0b2a4] focus:border-[#8a6a48]"
            />
          ) : (
            memory.caption && (
              <p className="hand mt-2 text-[22px] leading-[1.3] text-[#5d4f42]">{memory.caption}</p>
            )
          )}

          {isPaper && editing && (
            <textarea
              value={memory.text ?? ''}
              onChange={(e) => updateMemory(memory.id, { text: e.target.value })}
              rows={3}
              placeholder="What does it say?"
              className="mt-3 w-full resize-none rounded-[10px] border border-[rgba(120,92,62,0.25)] bg-[rgba(255,255,255,0.6)] p-3 text-[13px] leading-relaxed text-[#3f362a] outline-none focus:border-[#8a6a48]"
            />
          )}

          <div className="hairline my-5" />

          <dl className="space-y-[10px] text-[13px]">
            <Row label="Date">
              {editing ? (
                <input
                  type="date"
                  value={memory.date}
                  onChange={(e) => updateMemory(memory.id, { date: e.target.value })}
                  className="w-full bg-transparent text-[13px] font-semibold text-[#3f362a] outline-none"
                />
              ) : (
                <span className="font-semibold text-[#3f362a]">
                  {memory.date ? formatDate(memory.date) : '—'}
                </span>
              )}
            </Row>
            <Row label="Place">
              {editing ? (
                <input
                  value={memory.location}
                  onChange={(e) => updateMemory(memory.id, { location: e.target.value })}
                  placeholder="Where was this?"
                  className="w-full bg-transparent text-[13px] font-semibold text-[#3f362a] outline-none placeholder:font-normal placeholder:text-[#c0b2a4]"
                />
              ) : (
                <span className="font-semibold text-[#3f362a]">{memory.location || '—'}</span>
              )}
            </Row>
            <Row label="Tags">
              {editing ? (
                <input
                  value={memory.tags.join(', ')}
                  onChange={(e) =>
                    updateMemory(memory.id, {
                      tags: e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="summer, friends"
                  className="w-full bg-transparent text-[13px] font-semibold text-[#3f362a] outline-none placeholder:font-normal placeholder:text-[#c0b2a4]"
                />
              ) : memory.tags.length ? (
                <span className="flex flex-wrap gap-[6px]">
                  {memory.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full px-[9px] py-[3px] text-[11px] font-semibold text-[#6b5a45]"
                      style={{ background: 'rgba(120,92,62,0.12)' }}
                    >
                      {t}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-[#a6968a]">—</span>
              )}
            </Row>
          </dl>

          {editing && (
            <>
              <div className="hairline my-5" />
              {!isPaper && (
                <Picker label="Frame">
                  {FRAME_STYLES.map((f) => (
                    <Chip
                      key={f.id}
                      active={memory.frameStyle === f.id}
                      onClick={() => updateMemory(memory.id, { frameStyle: f.id as FrameStyle })}
                    >
                      {f.label}
                    </Chip>
                  ))}
                </Picker>
              )}

              {memory.type === 'sticky' && (
                <Picker label="Paper">
                  {STICKY_COLORS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => updateMemory(memory.id, { color: c.id as StickyColor })}
                      aria-label={c.label}
                      className="h-[26px] w-[26px] rounded-[6px] transition-transform hover:scale-105"
                      style={{
                        background: c.swatch,
                        boxShadow:
                          memory.color === c.id
                            ? '0 0 0 2px #8a6a48, inset 0 0 0 1px rgba(255,255,255,0.6)'
                            : 'inset 0 0 0 1px rgba(120,92,62,0.25)',
                      }}
                    />
                  ))}
                </Picker>
              )}

              <Picker label="Pin">
                {PIN_STYLES.map((p) => (
                  <button
                    key={p}
                    onClick={() => updateMemory(memory.id, { pinStyle: p as PinStyle })}
                    aria-label={`${p} pin`}
                    className="grid h-[30px] w-[30px] place-items-center rounded-[8px] transition-transform hover:scale-105"
                    style={{
                      background: memory.pinStyle === p ? 'rgba(120,92,62,0.16)' : 'transparent',
                      boxShadow: memory.pinStyle === p ? 'inset 0 0 0 1px rgba(120,92,62,0.3)' : 'none',
                    }}
                  >
                    {p === 'none' ? (
                      <span className="text-[10px] font-bold text-[#8b7d70]">off</span>
                    ) : p === 'tape' ? (
                      <span
                        className="block h-[10px] w-[20px] rotate-[-8deg] rounded-[1px]"
                        style={{ background: 'rgba(230,214,180,0.95)', boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.25)' }}
                      />
                    ) : (
                      <span className="-mb-[6px] block">
                        <Pin style={p} size={19} />
                      </span>
                    )}
                  </button>
                ))}
              </Picker>

              <Picker label="Angle">
                <input
                  type="range"
                  min={-18}
                  max={18}
                  step={0.5}
                  value={memory.rotation}
                  onChange={(e) => updateMemory(memory.id, { rotation: Number(e.target.value) })}
                  className="h-[4px] w-full flex-1 cursor-pointer appearance-none rounded-full"
                  style={{ background: 'rgba(120,92,62,0.25)', accentColor: '#a63a26' }}
                />
              </Picker>
            </>
          )}

          <div className="mt-6 flex items-center gap-2">
            <button
              onClick={() => setEditing((v) => !v)}
              className="flex-1 rounded-full py-[10px] text-[13px] font-bold transition-colors"
              style={
                editing
                  ? { background: 'linear-gradient(163deg,#c8563f,#a63a26)', color: '#fff6ea' }
                  : { background: 'rgba(120,92,62,0.13)', color: '#3f362a' }
              }
            >
              {editing ? 'Done' : 'Edit'}
            </button>
            <IconButton
              label={memory.favorite ? 'Remove from favourites' : 'Add to favourites'}
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
            </IconButton>
            <IconButton
              label="Delete memory"
              danger
              onClick={() => {
                deleteMemory(memory.id);
                onClose();
              }}
            >
              <path
                d="M3.4 4.6h9.2M6.4 4.6V3.2h3.2v1.4M5 4.6l.6 8h4.8l.6-8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </IconButton>
          </div>
        </motion.aside>
      </div>

      <button
        onClick={close}
        aria-label="Close"
        className="absolute right-5 top-5 grid h-[38px] w-[38px] place-items-center rounded-full text-[#f3e6d4] transition-colors hover:bg-[rgba(255,240,220,0.16)] min-[900px]:hidden"
        style={{ background: 'rgba(40,24,12,0.4)', backdropFilter: 'blur(6px)' }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline gap-4">
    <dt className="w-[52px] shrink-0 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#a6968a]">
      {label}
    </dt>
    <dd className="min-w-0 flex-1">{children}</dd>
  </div>
);

const Picker = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-3">
    <span className="eyebrow">{label}</span>
    <div className="mt-[7px] flex flex-wrap items-center gap-[6px]">{children}</div>
  </div>
);

const Chip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className="rounded-full px-[11px] py-[5px] text-[11.5px] font-semibold transition-colors"
    style={
      active
        ? { background: '#3f362a', color: '#fdf6e8' }
        : { background: 'rgba(120,92,62,0.12)', color: '#6b5a45' }
    }
  >
    {children}
  </button>
);

const IconButton = ({
  label,
  onClick,
  children,
  active,
  danger,
}: {
  label: string;
  onClick(): void;
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`grid h-[38px] w-[38px] place-items-center rounded-full transition-colors ${
      active
        ? 'text-[#bd4f3c]'
        : danger
          ? 'text-[#8a7466] hover:text-[#a83f2c]'
          : 'text-[#6b5a45] hover:text-[#241d18]'
    }`}
    style={{ background: 'rgba(120,92,62,0.13)' }}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {children}
    </svg>
  </button>
);
