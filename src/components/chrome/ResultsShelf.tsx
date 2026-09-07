import { motion } from 'framer-motion';
import type { Memory } from '../../lib/types';
import { useCork } from '../../lib/store';
import { useAssetUrl } from '../board/MemoryObject';
import { formatDate } from '../../lib/utils';

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
  return (
    // the wrapper does the centring: Motion owns `transform` on the panel
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
      style={{ bottom: 'max(18px, env(safe-area-inset-bottom, 0px))' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 26 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        className="panel pointer-events-auto rounded-[16px] px-4 pb-3 pt-[10px]"
        style={{ width: 'min(760px, calc(100vw - 32px))' }}
      >
        <div className="flex items-center justify-between pb-[9px]">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-bold text-[#241d18]">{title}</span>
            <span className="tnum text-[11.5px] text-[#9a8b7d]">
              {results.length} {results.length === 1 ? 'memory' : 'memories'}
            </span>
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
  );
}
