import { motion } from 'framer-motion';
import { BOARD_H, BOARD_W } from '../../lib/types';
import { Pin } from './Pin';

const SCRAPS = [
  { x: -452, y: -196, w: 148, h: 108, rot: -7, tone: '#f7efdb', pin: 'yellow' as const },
  { x: 318, y: -236, w: 120, h: 148, rot: 5.5, tone: '#f3e7cd', pin: 'blue' as const },
  { x: 366, y: 96, w: 166, h: 116, rot: -4, tone: '#f8f1de', pin: 'red' as const },
  { x: -412, y: 122, w: 130, h: 130, rot: 8, tone: '#f2e9d3', pin: 'white' as const },
];

const STRAY_PINS = [
  { x: -190, y: -246, style: 'metal' as const },
  { x: 236, y: 236, style: 'pastel' as const },
];

/**
 * An empty board is still a board: warm light, a few stray pins and blank
 * scraps waiting to be used — never an empty-state card.
 */
export function EmptyBoard({ onAdd }: { onAdd(): void }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: BOARD_W / 2, top: BOARD_H / 2, width: 0, height: 0 }}
    >
      {/* sunlight falling on the cork */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 1500,
          height: 1000,
          background:
            'radial-gradient(46% 42% at 44% 40%, rgba(255,241,209,0.5), rgba(255,241,209,0) 70%)',
          filter: 'blur(6px)',
        }}
      />

      {SCRAPS.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.94, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.15 + i * 0.08, type: 'spring', stiffness: 260, damping: 22 }}
          className="absolute"
          style={{ left: s.x, top: s.y, transform: `rotate(${s.rot}deg)` }}
        >
          <div
            className="paper-tex relative"
            style={{
              width: s.w,
              height: s.h,
              background: `linear-gradient(165deg, ${s.tone}, rgba(233,220,192,0.92))`,
              opacity: 0.78,
              boxShadow: '0 1px 1px rgba(58,34,12,0.22), 0 10px 18px -10px rgba(48,28,10,0.5)',
              borderRadius: 2,
            }}
          >
            <div className="absolute inset-x-[16%] top-[30%] space-y-[10px]" style={{ opacity: 0.34 }}>
              {[100, 74, 88].map((w, j) => (
                <div key={j} style={{ width: `${w}%`, height: 1.5, background: 'rgba(120,92,62,0.45)' }} />
              ))}
            </div>
          </div>
          <span
            className="absolute left-1/2 top-0"
            style={{ transform: `translate(-50%, -58%) rotate(${-s.rot}deg)` }}
          >
            <Pin style={s.pin} size={30} />
          </span>
        </motion.div>
      ))}

      {STRAY_PINS.map((p, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 + i * 0.07, type: 'spring', stiffness: 300, damping: 20 }}
          className="absolute"
          style={{ left: p.x, top: p.y }}
        >
          <Pin style={p.style} size={30} />
        </motion.div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
        style={{ width: 620 }}
      >
        <h2
          className="text-[42px] font-extrabold leading-[1.06] tracking-[-0.03em]"
          style={{ color: '#3d2a17', textShadow: '0 1px 0 rgba(255,236,206,0.4)' }}
        >
          Your memories belong somewhere.
        </h2>
        <p
          className="hand mt-3 text-[27px]"
          style={{ color: '#6b4a28', textShadow: '0 1px 0 rgba(255,236,206,0.35)' }}
        >
          Start pinning.
        </p>

        <button
          onClick={onAdd}
          onPointerDown={(e) => e.stopPropagation()}
          className="panel-solid group mt-7 flex items-center gap-2 rounded-full py-[11px] pl-[18px] pr-[22px] text-[14.5px] font-bold text-[#2f2419] transition-transform duration-200 hover:-translate-y-[2px] active:translate-y-0"
        >
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-full"
            style={{ background: 'linear-gradient(160deg,#d4614c,#a8351f)', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.45)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1.6v8.8M1.6 6h8.8" stroke="#fff5e8" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          Add a memory
        </button>

        <span
          className="mt-4 text-[12.5px] font-medium"
          style={{ color: '#6d4d2c', textShadow: '0 1px 0 rgba(255,240,214,0.4)' }}
        >
          or drop photos anywhere on the board
        </span>
      </motion.div>
    </div>
  );
}
