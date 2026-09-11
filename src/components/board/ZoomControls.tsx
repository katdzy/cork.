import { useMedia } from '../../lib/useMedia';
import type { SceneDef } from '../../scene/themes';

interface Props {
  zoom: number;
  /** Lifted above the results shelf when it is open. */
  raised?: boolean;
  /** The room this button would move you to — never the one you're in. */
  nextRoom: SceneDef;
  /** Square on to the board, two axes. */
  cork: boolean;
  onToggleCork(): void;
  onSwapRoom(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  onReset(): void;
}

const btn =
  'grid h-[30px] w-[30px] place-items-center rounded-full text-[#6b5a45] transition-colors hover:bg-[rgba(120,92,62,0.12)] hover:text-[#2f2419] disabled:opacity-40';

export function ZoomControls({
  zoom,
  raised,
  nextRoom,
  cork,
  onToggleCork,
  onSwapRoom,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: Props) {
  // the results shelf is centred and capped at 760px — it only reaches the
  // corner controls on narrower screens
  const collides = !useMedia('(min-width: 1160px)');

  return (
    <div
      data-board-chrome
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
        title={cork ? 'Frame the board' : 'Reset view'}
        aria-label={`Zoom ${Math.round(zoom * 100)} percent — ${cork ? 'frame the board' : 'reset view'}`}
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

      {/* Square on to the board, and flat.
          A toggle rather than a "go here" button like the room below: it is a
          mode, it is reversible with the same tap, and what it is doing to
          every gesture on the surface underneath should be visible without
          making one. Hence `aria-pressed` and a filled state, rather than an
          icon that quietly swaps to the other thing. */}
      <button
        data-tour="cork"
        className={cork ? `${btn} hover:bg-transparent` : btn}
        style={cork ? { background: '#3f362a', color: '#fdf6e8' } : undefined}
        onClick={onToggleCork}
        aria-pressed={cork}
        aria-label={cork ? 'Leave the cork view' : 'Cork view — square on to the board'}
        title={cork ? 'Back to the room · esc' : 'Cork view — square on, slide and zoom only'}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect
            x="2.6"
            y="4.4"
            width="10.8"
            height="8.4"
            rx="1.3"
            stroke="currentColor"
            strokeWidth="1.45"
          />
          <circle cx="8" cy="2.5" r="1.25" fill="currentColor" />
        </svg>
      </button>

      <span className="mx-[3px] h-[18px] w-px bg-[rgba(120,92,62,0.2)]" />

      {/* The room, not a theme: it moves the board to a different wall. The
          button shows where you would be going, never where you are. */}
      <button
        className={btn}
        onClick={onSwapRoom}
        aria-label={`Move to the ${nextRoom.label.toLowerCase()} — ${nextRoom.blurb.toLowerCase()}`}
        title={`${nextRoom.label} · ${nextRoom.blurb}`}
      >
        {nextRoom.id === 'studio' ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1.4v2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M3.2 9.1a4.8 4.8 0 0 1 9.6 0z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M6.4 11.6h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M7 14h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
