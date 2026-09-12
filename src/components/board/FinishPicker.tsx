import { motion } from 'framer-motion';
import { MODELS, setFinish, setModel, useLaptop } from '../../scene/models';

/**
 * The laptop's own controls, over the laptop.
 *
 * Which machine, and then what colour it came in. Put where the thing they
 * change is: a preference about an object you can see is a strange thing to
 * have to go and find in a sheet, and here the swatch and the machine are in
 * the same glance, so choosing one is a before-and-after rather than a guess
 * followed by a trip back to the room to see what you did.
 *
 * It hangs above the lid and points down at it, which is what keeps it reading
 * as belonging to the laptop rather than floating over the counter — a panel
 * with nothing tying it to a thing is chrome, and there is enough of that.
 */
export function FinishPicker({ at }: { at: { x: number; y: number } }) {
  const { model, finish } = useLaptop();

  return (
    <motion.div
      data-board-chrome
      data-finish
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 460, damping: 32 }}
      className="panel-solid absolute z-30 rounded-[15px] px-3 pb-[11px] pt-[7px]"
      style={{
        left: at.x,
        top: at.y - 18,
        x: '-50%',
        y: '-100%',
        // it grows out of the machine it belongs to, not out of the middle of nowhere
        transformOrigin: 'bottom center',
      }}
    >
      <div className="flex items-center justify-center gap-[3px]">
        {MODELS.map((m) => {
          const on = m.id === model.id;
          return (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              aria-pressed={on}
              className="rounded-full px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] transition-colors"
              style={{
                background: on ? 'rgba(120,92,62,0.14)' : 'transparent',
                color: on ? '#3f362a' : '#a2958a',
              }}
            >
              {m.short}
            </button>
          );
        })}
      </div>

      <div className="mt-[7px] flex items-center justify-center gap-[9px]">
        {model.finishes.map((f) => {
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
