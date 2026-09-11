import { motion } from 'framer-motion';
import { FINISHES, setFinish, useFinish } from '../../scene/finish';

/**
 * The laptop's colours, over the laptop.
 *
 * The same six that are in Settings, put where the thing they change is. A
 * preference about an object you can see is a strange thing to have to go and
 * find in a sheet: here the swatch and the machine are in the same glance, and
 * choosing one is a before-and-after rather than a guess followed by a trip
 * back to the room to see what you did.
 *
 * It hangs above the lid and points down at it, which is what keeps it read as
 * belonging to the laptop rather than floating over the counter — a panel with
 * nothing tying it to a thing is chrome, and there is enough of that already.
 */
export function FinishPicker({ at }: { at: { x: number; y: number } }) {
  const finish = useFinish();

  return (
    <motion.div
      data-board-chrome
      data-finish
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 460, damping: 32 }}
      className="panel-solid absolute z-30 rounded-[15px] px-3 pb-[11px] pt-2"
      style={{
        left: at.x,
        top: at.y - 18,
        x: '-50%',
        y: '-100%',
        // it grows out of the machine it belongs to, not out of the middle of nowhere
        transformOrigin: 'bottom center',
      }}
    >
      <span className="eyebrow block text-center text-[9px]">{finish.label}</span>
      <div className="mt-[7px] flex items-center gap-[9px]">
        {FINISHES.map((f) => {
          const on = f.id === finish.id;
          return (
            <button
              key={f.id}
              onClick={() => setFinish(f.id)}
              aria-pressed={on}
              aria-label={f.label}
              title={f.label}
              className="h-[19px] w-[19px] rounded-full transition-transform duration-150 hover:scale-[1.18]"
              style={{
                background: `#${f.body.toString(16).padStart(6, '0')}`,
                boxShadow: on
                  ? '0 0 0 1.5px rgba(255,253,247,0.95), 0 0 0 2.75px #8a6a48, inset 0 1px 2px rgba(255,255,255,0.5), inset 0 -1px 2px rgba(28,20,10,0.22)'
                  : '0 0 0 1px rgba(70,52,32,0.2), inset 0 1px 2px rgba(255,255,255,0.5), inset 0 -1px 2px rgba(28,20,10,0.22)',
              }}
            />
          );
        })}
      </div>

      {/* the tail, pointing back at the lid */}
      <span
        aria-hidden
        className="absolute left-1/2 h-[9px] w-[9px] -translate-x-1/2 rotate-45"
        style={{
          bottom: -5,
          background: '#f7f1e3',
          borderRight: '1px solid rgba(120,92,62,0.18)',
          borderBottom: '1px solid rgba(120,92,62,0.18)',
        }}
      />
    </motion.div>
  );
}
