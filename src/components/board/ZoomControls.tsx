import { useMedia } from '../../lib/useMedia';

interface Props {
  zoom: number;
  /** Lifted above the results shelf when it is open. */
  raised?: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  onReset(): void;
}

const btn =
  'grid h-[30px] w-[30px] place-items-center rounded-full text-[#6b5a45] transition-colors hover:bg-[rgba(120,92,62,0.12)] hover:text-[#2f2419] disabled:opacity-40';

export function ZoomControls({ zoom, raised, onZoomIn, onZoomOut, onFit, onReset }: Props) {
  // the results shelf is centred and capped at 760px — it only reaches the
  // corner controls on narrower screens
  const collides = !useMedia('(min-width: 1160px)');

  return (
    <div
      className="panel pointer-events-auto absolute right-5 z-30 flex items-center gap-[2px] rounded-full p-[4px] transition-[bottom] duration-300 max-[899px]:left-3 max-[899px]:right-auto"
      style={{
        bottom:
          raised && collides
            ? 'calc(198px + env(safe-area-inset-bottom, 0px))'
            : 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 16px))',
      }}
    >
      <button className={btn} onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      <button
        onClick={onReset}
        title="Reset view"
        aria-label={`Zoom ${Math.round(zoom * 100)} percent — reset view`}
        className="tnum min-w-[46px] rounded-full px-1 text-center text-[11.5px] font-bold text-[#5d4f42] transition-colors hover:text-[#2f2419]"
      >
        {Math.round(zoom * 100)}%
      </button>

      <button className={btn} onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      <span className="mx-[3px] h-[18px] w-px bg-[rgba(120,92,62,0.2)]" />

      <button className={btn} onClick={onFit} aria-label="Fit all memories" title="Fit all">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.6 6V3.4a.8.8 0 0 1 .8-.8H6M10 2.6h2.6a.8.8 0 0 1 .8.8V6M13.4 10v2.6a.8.8 0 0 1-.8.8H10M6 13.4H3.4a.8.8 0 0 1-.8-.8V10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
