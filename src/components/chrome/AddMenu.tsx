import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { addPaperObject } from '../../lib/createMemories';
import { useCork } from '../../lib/store';

type ObjectKind = 'sticky' | 'note' | 'ticket' | 'label' | 'postcard';

const OPTIONS: { kind: ObjectKind; label: string; hint: string; swatch: string }[] = [
  { kind: 'sticky', label: 'Sticky note', hint: 'a quick thought', swatch: 'linear-gradient(160deg,#f8e6a4,#eecf72)' },
  { kind: 'note', label: 'Handwritten note', hint: 'torn from a pad', swatch: 'linear-gradient(160deg,#fffdf4,#efe6d0)' },
  { kind: 'ticket', label: 'Ticket stub', hint: 'a night worth keeping', swatch: 'linear-gradient(160deg,#fdf5e2,#e6d3a8)' },
  { kind: 'label', label: 'Little label', hint: 'name a corner', swatch: 'linear-gradient(160deg,#f0e3c6,#dcc79c)' },
  { kind: 'postcard', label: 'Postcard', hint: 'from somewhere else', swatch: 'linear-gradient(160deg,#fdf8ea,#dfd0ae)' },
];

interface Props {
  onPickFiles(files: File[]): void;
  centerPoint(): { x: number; y: number };
  compact?: boolean;
}

export function AddMenu({ onPickFiles, centerPoint, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const select = useCork((s) => s.select);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const create = (kind: ObjectKind) => {
    const at = centerPoint();
    const memory = addPaperObject(kind, {
      x: at.x + (Math.random() - 0.5) * 90,
      y: at.y + (Math.random() - 0.5) * 70,
    });
    select(memory.id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} data-tour="add" className="pointer-events-auto relative">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onPickFiles(files);
          e.target.value = '';
          setOpen(false);
        }}
      />

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-full font-bold text-[#fff6ea] transition-transform duration-200 hover:-translate-y-[1px] active:translate-y-0 ${
          compact ? 'h-[52px] w-[52px] justify-center' : 'h-10 pl-[13px] pr-[17px] text-[13.5px]'
        }`}
        style={{
          background: 'linear-gradient(163deg,#c8563f 0%,#a63a26 100%)',
          boxShadow:
            '0 1px 1px rgba(90,30,16,0.4), 0 8px 18px -6px rgba(120,44,24,0.6), inset 0 1px 0 rgba(255,220,196,0.4)',
        }}
      >
        <motion.svg
          width={compact ? 20 : 15}
          height={compact ? 20 : 15}
          viewBox="0 0 16 16"
          aria-hidden="true"
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        >
          <path d="M8 2.6v10.8M2.6 8h10.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </motion.svg>
        {!compact && 'Add'}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={`panel absolute z-40 w-[258px] rounded-[16px] p-[6px] ${
              compact ? 'bottom-[62px] right-0 origin-bottom-right' : 'right-0 top-[50px] origin-top-right'
            }`}
          >
            <button
              role="menuitem"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-[11px] px-[10px] py-[10px] text-left transition-colors hover:bg-[rgba(120,92,62,0.09)]"
            >
              <span
                className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px]"
                style={{
                  background: 'linear-gradient(160deg,#fffdf6,#efe6d2)',
                  boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.18)',
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 16.5l4.2-4a1.5 1.5 0 0 1 2 0l3.3 3M12.6 14.4l1.6-1.5a1.5 1.5 0 0 1 2 0L20 16M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5z"
                    stroke="#8a6a48"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="flex-1">
                <span className="block text-[13.5px] font-bold text-[#241d18]">Photos</span>
                <span className="block text-[11.5px] text-[#8b7d70]">
                  strips and scans included
                </span>
              </span>
            </button>

            <div className="hairline my-[5px]" />

            {OPTIONS.map((o) => (
              <button
                key={o.kind}
                role="menuitem"
                onClick={() => create(o.kind)}
                className="flex w-full items-center gap-3 rounded-[11px] px-[10px] py-[8px] text-left transition-colors hover:bg-[rgba(120,92,62,0.09)]"
              >
                <span
                  className="h-[26px] w-[26px] shrink-0 rounded-[6px]"
                  style={{
                    background: o.swatch,
                    boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.2), 0 1px 2px rgba(60,38,16,0.2)',
                    transform: `rotate(${o.kind === 'label' ? -6 : 3}deg)`,
                  }}
                />
                <span className="flex-1">
                  <span className="block text-[13px] font-semibold text-[#3f362a]">{o.label}</span>
                  <span className="block text-[11px] text-[#9a8b7d]">{o.hint}</span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
