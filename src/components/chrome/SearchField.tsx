import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useCork } from '../../lib/store';

export function SearchField({
  resultCount,
  expandedWidth = 268,
}: {
  resultCount: number;
  expandedWidth?: number;
}) {
  const query = useCork((s) => s.query);
  const setQuery = useCork((s) => s.setQuery);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /input|textarea/i.test(target.tagName);
      if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k'))) {
        e.preventDefault();
        setOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 40);
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setQuery('');
        inputRef.current?.blur();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setQuery]);

  const expanded = open || Boolean(query);

  return (
    <motion.div
      className="panel pointer-events-auto flex items-center rounded-full"
      initial={{ width: expanded ? expandedWidth : 40 }}
      animate={{ width: expanded ? expandedWidth : 40 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      style={{ height: 40, overflow: 'hidden' }}
    >
      <button
        aria-label="Search memories"
        onClick={() => {
          setOpen(true);
          window.setTimeout(() => inputRef.current?.focus(), 40);
        }}
        className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full text-[#6b5a45] transition-colors hover:text-[#2f2419]"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7.2" cy="7.2" r="4.4" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.6 10.6L13.4 13.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => !query && setOpen(false)}
        placeholder="Search captions, tags, places…"
        aria-label="Search memories"
        className="min-w-0 flex-1 bg-transparent pr-2 text-[13px] font-medium text-[#241d18] outline-none placeholder:text-[#a6968a]"
      />

      {query && (
        <>
          <span className="tnum shrink-0 pr-1 text-[11px] font-bold text-[#a6968a]">{resultCount}</span>
          <button
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="mr-[5px] grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full text-[#8b7d70] transition-colors hover:bg-[rgba(120,92,62,0.12)] hover:text-[#2f2419]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.6 2.6l6.8 6.8M9.4 2.6l-6.8 6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </>
      )}
    </motion.div>
  );
}
