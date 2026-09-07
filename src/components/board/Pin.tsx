import { useId } from 'react';
import type { PinStyle } from '../../lib/types';

interface PinPalette {
  hi: string;
  mid: string;
  low: string;
  rim: string;
  opacity?: number;
}

const PALETTES: Record<Exclude<PinStyle, 'none' | 'tape'>, PinPalette> = {
  red: { hi: '#f08a72', mid: '#c8422f', low: '#7e2115', rim: '#5d1810' },
  blue: { hi: '#9cc4de', mid: '#4a7fa8', low: '#25506e', rim: '#1c3d56' },
  yellow: { hi: '#f7dd9a', mid: '#dfae3c', low: '#96701c', rim: '#725415' },
  white: { hi: '#ffffff', mid: '#efe8d9', low: '#bdb29c', rim: '#9a8f7a' },
  metal: { hi: '#ffffff', mid: '#c3cad1', low: '#78828b', rim: '#59636b' },
  pastel: { hi: '#f7d6dd', mid: '#dca7b4', low: '#a97080', rim: '#8b5b69' },
  glass: { hi: '#ffffff', mid: '#cfe2e8', low: '#8fa9b3', rim: '#7a949e', opacity: 0.72 },
};

export const PIN_STYLES: PinStyle[] = [
  'red',
  'blue',
  'yellow',
  'white',
  'metal',
  'pastel',
  'glass',
  'tape',
  'none',
];

/**
 * A push pin drawn as a real object: domed head with a specular highlight,
 * a collar, a needle disappearing into the cork, and its own cast shadow.
 */
export function Pin({
  style = 'red',
  size = 36,
  pressed = false,
}: {
  style?: PinStyle;
  size?: number;
  pressed?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  if (style === 'none' || style === 'tape') return null;
  const p = PALETTES[style];

  return (
    <svg
      width={size}
      height={size * 1.18}
      viewBox="0 0 36 42"
      fill="none"
      aria-hidden="true"
      style={{
        transform: pressed ? 'translateY(1px) scale(0.97)' : 'none',
        transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        overflow: 'visible',
      }}
    >
      <defs>
        <radialGradient id={`head-${uid}`} cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor={p.hi} />
          <stop offset="46%" stopColor={p.mid} />
          <stop offset="100%" stopColor={p.low} />
        </radialGradient>
        <linearGradient id={`needle-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6b7078" />
          <stop offset="40%" stopColor="#d7dce1" />
          <stop offset="100%" stopColor="#5a6067" />
        </linearGradient>
        <linearGradient id={`collar-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.hi} stopOpacity="0.9" />
          <stop offset="100%" stopColor={p.low} />
        </linearGradient>
      </defs>

      {/* shadow cast onto whatever is underneath */}
      <ellipse cx="21.5" cy="35.5" rx="9.5" ry="3.2" fill="#3a2110" opacity="0.34" />

      {/* needle */}
      <path d="M17.4 24 L19.6 24 L21.2 35.4 L18.6 35.9 Z" fill={`url(#needle-${uid})`} />

      {/* collar */}
      <path
        d="M11.6 21.6 c1.8 2.4 4 3.6 6.6 3.6 s4.8-1.2 6.6-3.6 l-1.2 3.4 c-1.5 1.7-3.3 2.6-5.4 2.6 s-3.9-.9-5.4-2.6 z"
        fill={`url(#collar-${uid})`}
        opacity={p.opacity ?? 1}
      />

      {/* head */}
      <circle cx="18.2" cy="14" r="11.2" fill={`url(#head-${uid})`} opacity={p.opacity ?? 1} />
      <circle
        cx="18.2"
        cy="14"
        r="11.2"
        fill="none"
        stroke={p.rim}
        strokeOpacity="0.45"
        strokeWidth="0.7"
      />
      {/* speculars */}
      <ellipse cx="13.9" cy="9.6" rx="4" ry="3" fill="#ffffff" opacity="0.72" />
      <ellipse cx="23" cy="19" rx="3.4" ry="1.9" fill="#ffffff" opacity="0.18" />
      {style === 'glass' && (
        <circle cx="18.2" cy="14" r="7.4" fill="#ffffff" opacity="0.14" />
      )}
    </svg>
  );
}

/**
 * Washi tape — the alternative to a pin for paper things.
 */
export function Tape({ width = 74, tone = 'cream' }: { width?: number; tone?: 'cream' | 'blush' }) {
  const uid = useId().replace(/:/g, '');
  const colors =
    tone === 'blush'
      ? { a: 'rgba(214,158,158,0.72)', b: 'rgba(196,132,132,0.62)' }
      : { a: 'rgba(246,236,214,0.82)', b: 'rgba(226,210,178,0.7)' };
  return (
    <svg
      width={width}
      height={26}
      viewBox={`0 0 ${width} 26`}
      fill="none"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`tape-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.a} />
          <stop offset="100%" stopColor={colors.b} />
        </linearGradient>
      </defs>
      <path
        d={`M2 4 L${width - 3} 2 L${width - 1} 22 L4 24 Z`}
        fill={`url(#tape-${uid})`}
        stroke="rgba(120,92,62,0.16)"
        strokeWidth="0.8"
      />
      <path d={`M2 4 L${width - 3} 2 L${width - 3} 7 L2 9 Z`} fill="#ffffff" opacity="0.28" />
    </svg>
  );
}
