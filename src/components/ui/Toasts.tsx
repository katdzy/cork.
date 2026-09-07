import { AnimatePresence, motion } from 'framer-motion';
import { useCork } from '../../lib/store';

export function Toasts({ raised }: { raised?: boolean }) {
  const toasts = useCork((s) => s.toasts);
  const dismiss = useCork((s) => s.dismissToast);

  return (
    <div
      className="pointer-events-none absolute left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ bottom: raised ? 200 : 'max(74px, calc(env(safe-area-inset-bottom, 0px) + 74px))' }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="panel pointer-events-auto flex items-center gap-3 rounded-full py-[9px] pl-4 pr-[10px]"
          >
            <span className="text-[13px] font-semibold text-[#3f362a]">{t.message}</span>
            {t.actionLabel && (
              <button
                onClick={() => {
                  t.action?.();
                  dismiss(t.id);
                }}
                className="rounded-full px-[11px] py-[4px] text-[12px] font-bold text-[#a63a26] transition-colors hover:bg-[rgba(189,79,60,0.12)]"
              >
                {t.actionLabel}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
