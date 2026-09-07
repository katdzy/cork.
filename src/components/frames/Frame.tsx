import { memo } from 'react';
import type { FrameStyle, Memory } from '../../lib/types';
import { formatDateShort, hashNoise } from '../../lib/utils';

export const FRAME_STYLES: { id: FrameStyle; label: string }[] = [
  { id: 'polaroid', label: 'Polaroid' },
  { id: 'print', label: 'Photo print' },
  { id: 'vintage', label: 'Vintage film' },
  { id: 'modern', label: 'Modern' },
  { id: 'noir', label: 'Black' },
  { id: 'scrapbook', label: 'Scrapbook' },
  { id: 'strip', label: 'Strip' },
];

/** A torn-paper edge, stable for a given id. */
function tornPolygon(seed: string): string {
  const pts: string[] = [];
  const steps = 11;
  const j = (i: number, salt: number) => (hashNoise(seed, i * 7 + salt) - 0.5) * 2.4;
  for (let i = 0; i <= steps; i++) pts.push(`${(i / steps) * 100}% ${Math.max(0, 1.4 + j(i, 1))}%`);
  for (let i = 0; i <= steps; i++)
    pts.push(`${100 - Math.max(0, 1.4 + j(i, 2))}% ${(i / steps) * 100}%`);
  for (let i = steps; i >= 0; i--)
    pts.push(`${(i / steps) * 100}% ${100 - Math.max(0, 1.4 + j(i, 3))}%`);
  for (let i = steps; i >= 0; i--) pts.push(`${Math.max(0, 1.4 + j(i, 4))}% ${(i / steps) * 100}%`);
  return `polygon(${pts.join(',')})`;
}

const PhotoSurface = ({
  src,
  alt,
  w,
  h,
  radius = 0,
  grade,
}: {
  src?: string;
  alt: string;
  w: number;
  h: number;
  radius?: number;
  grade?: string;
}) => (
  <div
    className="relative overflow-hidden bg-[#d9cdb8]"
    style={{ width: w, height: h, borderRadius: radius }}
  >
    {src ? (
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="block h-full w-full object-cover"
        style={{ filter: grade }}
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#e4dac6,#cdbfa5)]">
        <span className="text-[11px] font-semibold tracking-[0.18em] text-[#8b7a63]">NO IMAGE</span>
      </div>
    )}
    {/* light falling across the print */}
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          'linear-gradient(148deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.04) 34%, rgba(60,38,16,0.06) 78%, rgba(60,38,16,0.14) 100%)',
      }}
    />
    <div
      className="pointer-events-none absolute inset-0"
      style={{ boxShadow: 'inset 0 0 1px rgba(40,24,10,0.5), inset 0 2px 6px rgba(40,24,10,0.16)' }}
    />
  </div>
);

interface FrameProps {
  memory: Memory;
  src?: string;
  width: number;
  height: number;
}

/**
 * Renders a photo as a physical print. Every style is a real paper object with
 * its own border, weight and imperfection — the frame is the container, so the
 * outer box is always image + chrome.
 */
export const Frame = memo(function Frame({ memory, src, width, height }: FrameProps) {
  const alt = memory.title || memory.caption || 'Memory';
  const style: FrameStyle = memory.frameStyle;

  if (style === 'polaroid') {
    const chin = Math.max(52, Math.round(width * 0.19));
    return (
      <div
        className="paper-tex relative"
        style={{
          padding: '13px 13px 0',
          background: 'linear-gradient(168deg,#fffdf6 0%,#f8f2e6 60%,#efe7d6 100%)',
          borderRadius: 3,
          boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.10)',
        }}
      >
        <PhotoSurface src={src} alt={alt} w={width} h={height} />
        <div
          className="flex flex-col items-center justify-center px-3 text-center"
          style={{ height: chin, width }}
        >
          {memory.caption ? (
            <span
              className="hand leading-tight text-[#3a2f26]"
              style={{ fontSize: Math.max(17, width * 0.072) }}
            >
              {memory.caption}
            </span>
          ) : (
            <span
              className="hand leading-tight text-[#b0a091]"
              style={{ fontSize: Math.max(16, width * 0.066) }}
            >
              {memory.title || ' '}
            </span>
          )}
          {memory.date && (
            <span className="mono mt-[3px] text-[8.5px] tracking-[0.14em] text-[#a8998a]">
              {formatDateShort(memory.date)}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (style === 'print') {
    return (
      <div
        className="paper-tex relative"
        style={{
          padding: '11px 11px 18px',
          background: 'linear-gradient(170deg,#fffefa,#f4eee2)',
          borderRadius: 2,
          boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.09)',
        }}
      >
        <PhotoSurface src={src} alt={alt} w={width} h={height} />
        {memory.caption && (
          <div
            className="hand2 absolute bottom-[2px] left-0 w-full truncate px-3 text-center text-[#5e5147]"
            style={{ fontSize: 11 }}
          >
            {memory.caption}
          </div>
        )}
      </div>
    );
  }

  if (style === 'vintage') {
    return (
      <div
        className="paper-tex relative"
        style={{
          padding: 14,
          background: 'linear-gradient(165deg,#fdf6e4,#efe2c8)',
          borderRadius: 6,
          boxShadow: 'inset 0 0 0 1px rgba(150,116,70,0.16)',
        }}
      >
        <PhotoSurface
          src={src}
          alt={alt}
          w={width}
          h={height}
          radius={2}
          grade="sepia(0.24) saturate(1.08) contrast(1.03) brightness(1.02)"
        />
        {memory.date && (
          <span
            className="mono absolute bottom-[22px] right-[24px] text-[10px] tracking-[0.06em]"
            style={{ color: '#f0a24a', textShadow: '0 0 6px rgba(240,140,40,0.65)' }}
          >
            {memory.date.replaceAll('-', ' ').slice(2)}
          </span>
        )}
      </div>
    );
  }

  if (style === 'modern') {
    return (
      <div
        className="relative"
        style={{
          padding: 5,
          background: 'linear-gradient(170deg,#fffdf8,#f2ece0)',
          borderRadius: 14,
          boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.12)',
        }}
      >
        <PhotoSurface src={src} alt={alt} w={width} h={height} radius={10} />
      </div>
    );
  }

  if (style === 'noir') {
    return (
      <div
        className="relative"
        style={{
          padding: 9,
          background: 'linear-gradient(168deg,#2a2723,#141210)',
          borderRadius: 2,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ padding: 1, background: 'rgba(255,253,247,0.85)' }}>
          <PhotoSurface src={src} alt={alt} w={width} h={height} />
        </div>
      </div>
    );
  }

  if (style === 'scrapbook') {
    return (
      <div className="relative" style={{ padding: 16 }}>
        <div
          className="paper-tex absolute inset-0"
          style={{
            background: 'linear-gradient(160deg,#fdf7e8,#eee2c9)',
            clipPath: tornPolygon(memory.id),
            boxShadow: 'inset 0 0 0 1px rgba(150,116,70,0.10)',
          }}
        />
        <div className="relative">
          <PhotoSurface src={src} alt={alt} w={width} h={height} />
          {/* corner mounts */}
          {[
            { top: -3, left: -3, rot: 0 },
            { top: -3, right: -3, rot: 90 },
            { bottom: -3, right: -3, rot: 180 },
            { bottom: -3, left: -3, rot: 270 },
          ].map((c, i) => (
            <span
              key={i}
              className="absolute block"
              style={{
                ...c,
                width: 17,
                height: 17,
                transform: `rotate(${c.rot}deg)`,
                background: 'linear-gradient(135deg, rgba(58,42,26,0.82) 48%, transparent 49%)',
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  /* photobooth strip */
  return (
    <div
      className="paper-tex relative"
      style={{
        padding: '9px 9px 26px',
        background: 'linear-gradient(172deg,#fffdf6,#f2ebdb)',
        borderRadius: 2,
        boxShadow: 'inset 0 0 0 1px rgba(120,92,62,0.12)',
      }}
    >
      <PhotoSurface src={src} alt={alt} w={width} h={height} />
      <div
        className="absolute bottom-[7px] left-0 w-full text-center text-[7px] font-bold tracking-[0.26em]"
        style={{ color: '#9c8b74' }}
      >
        PHOTO BOOTH
      </div>
    </div>
  );
});
