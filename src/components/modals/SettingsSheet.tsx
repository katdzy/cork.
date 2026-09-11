import { useState } from 'react';
import { motion } from 'framer-motion';
import { useCork } from '../../lib/store';
import { setGraphicsPref, useGraphics, type GraphicsPref, type Tier } from '../../scene/quality';
import { FINISHES, setFinish, useFinish } from '../../scene/finish';
import { Wordmark } from '../chrome/Wordmark';

const GRAPHICS: ReadonlyArray<[GraphicsPref, string]> = [
  ['auto', 'Auto'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
];

const TIER_WORDS: Record<Tier, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** The body colour, as CSS, for the swatch that stands for it. */
const swatch = (body: number) => `#${body.toString(16).padStart(6, '0')}`;

const TIER_BLURBS: Record<Tier, string> = {
  low: 'Smaller shadow maps, quarter-size surfaces and no light shafts, for a machine that would rather not.',
  medium: 'A balance — most of the detail, at half the texture size.',
  high: 'Everything: the largest shadow maps, full-size surfaces, the finest light trace.',
};

export function SettingsSheet({ onClose }: { onClose(): void }) {
  const boards = useCork((s) => s.boards);
  const memories = useCork((s) => s.memories);
  const activeBoardId = useCork((s) => s.activeBoardId);
  const updateBoard = useCork((s) => s.updateBoard);
  const deleteBoard = useCork((s) => s.deleteBoard);
  const resetEverything = useCork((s) => s.resetEverything);
  const { pref, tier } = useGraphics();
  const finish = useFinish();
  const board = boards.find((b) => b.id === activeBoardId);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const boardCount = memories.filter((m) => m.boardId === activeBoardId).length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4" role="dialog" aria-modal="true" aria-label="Settings">
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-label="Close settings"
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(38,22,10,0.55)', backdropFilter: 'blur(6px)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="panel-solid relative w-full max-w-[440px] rounded-[20px] p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-[#241d18]">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-[30px] w-[30px] place-items-center rounded-full text-[#8b7d70] transition-colors hover:bg-[rgba(120,92,62,0.12)] hover:text-[#2f2419]"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="hairline my-5" />

        <span className="eyebrow">This board</span>
        <input
          value={board?.name ?? ''}
          onChange={(e) => board && updateBoard(board.id, { name: e.target.value })}
          className="mt-2 w-full rounded-[11px] border border-[rgba(120,92,62,0.25)] bg-[rgba(255,255,255,0.6)] px-3 py-[10px] text-[14px] font-semibold text-[#241d18] outline-none focus:border-[#8a6a48]"
        />
        <input
          value={board?.description ?? ''}
          placeholder="A short description"
          onChange={(e) => board && updateBoard(board.id, { description: e.target.value })}
          className="mt-2 w-full rounded-[11px] border border-[rgba(120,92,62,0.25)] bg-[rgba(255,255,255,0.6)] px-3 py-[9px] text-[13px] text-[#5d4f42] outline-none placeholder:text-[#b3a496] focus:border-[#8a6a48]"
        />

        <button
          disabled={boards.length <= 1}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            if (board) deleteBoard(board.id);
            onClose();
          }}
          className="mt-3 w-full rounded-[11px] py-[10px] text-[13px] font-bold transition-colors disabled:opacity-40"
          style={{
            background: confirmDelete ? 'rgba(189,79,60,0.16)' : 'rgba(120,92,62,0.1)',
            color: confirmDelete ? '#a83f2c' : '#6b5a45',
          }}
        >
          {confirmDelete
            ? `Delete “${board?.name}” and its ${boardCount} ${boardCount === 1 ? 'memory' : 'memories'}?`
            : 'Delete this board'}
        </button>

        <div className="hairline my-5" />

        <span className="eyebrow">Fujikey Nero</span>
        <div className="mt-3 flex items-center gap-[13px]">
          {FINISHES.map((f) => {
            const on = f.id === finish.id;
            return (
              <button
                key={f.id}
                onClick={() => setFinish(f.id)}
                aria-pressed={on}
                aria-label={f.label}
                title={f.label}
                className="h-[28px] w-[28px] rounded-full transition-transform duration-150 hover:scale-[1.12]"
                style={{
                  background: swatch(f.body),
                  /* A lit rim rather than a border, so a swatch reads as the
                     anodised metal it stands for and not as a paint chip. */
                  boxShadow: on
                    ? '0 0 0 2px rgba(255,253,247,0.95), 0 0 0 3.5px #8a6a48, inset 0 1.5px 2.5px rgba(255,255,255,0.5), inset 0 -1.5px 3px rgba(28,20,10,0.22)'
                    : '0 0 0 1px rgba(70,52,32,0.18), inset 0 1.5px 2.5px rgba(255,255,255,0.5), inset 0 -1.5px 3px rgba(28,20,10,0.22)',
                }}
              />
            );
          })}
        </div>
        <p className="mt-3 text-[13px] leading-[1.5] text-[#5d4f42]">
          <span className="font-bold text-[#3f362a]">{finish.label}.</span> Anodised rather than
          painted, so the colour sits in the metal and the window still comes off it. The keys, the
          bezel and the wallpaper stay as they are.
        </p>

        <div className="hairline my-5" />

        <span className="eyebrow">Graphics</span>
        <div className="mt-2 flex gap-1.5 rounded-[11px] bg-[rgba(120,92,62,0.09)] p-1">
          {GRAPHICS.map(([value, label]) => {
            const on = pref === value;
            return (
              <button
                key={value}
                onClick={() => setGraphicsPref(value)}
                aria-pressed={on}
                className="flex-1 rounded-[8px] py-[7px] text-[12.5px] font-bold transition-colors"
                style={{
                  background: on ? 'rgba(255,253,247,0.95)' : 'transparent',
                  color: on ? '#2f2419' : '#7d6f64',
                  boxShadow: on ? '0 1px 2px rgba(52,34,18,0.14)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] leading-[1.5] text-[#5d4f42]">
          {pref === 'auto'
            ? `Matched to this device — currently ${TIER_WORDS[tier]}.`
            : TIER_BLURBS[tier]}{' '}
          Shadows, texture detail and how finely the room&rsquo;s light is traced all follow this;
          changing it builds the room again.
        </p>

        <div className="hairline my-5" />

        <span className="eyebrow">Your memories</span>
        <p className="mt-2 text-[13px] leading-[1.5] text-[#5d4f42]">
          {memories.length} memories across {boards.length} boards, kept on this device in your
          browser. Nothing is uploaded anywhere — moving, resizing and re-framing all save
          automatically.
        </p>

        <button
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            void resetEverything();
            onClose();
          }}
          className="mt-3 w-full rounded-[11px] py-[10px] text-[13px] font-bold transition-colors"
          style={{
            background: confirmReset ? 'rgba(189,79,60,0.16)' : 'rgba(120,92,62,0.1)',
            color: confirmReset ? '#a83f2c' : '#6b5a45',
          }}
        >
          {confirmReset ? 'Erase everything and restore the demo board?' : 'Start over'}
        </button>

        <div className="mt-6 flex items-center justify-between">
          <Wordmark size={16} />
          <span className="hand text-[16px] text-[#a6968a]">keep your memories close</span>
        </div>
      </motion.div>
    </div>
  );
}
