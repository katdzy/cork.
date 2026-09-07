import { useMemo } from 'react';
import { BOARD_H, BOARD_W } from '../../lib/types';
import { corkTiles } from '../../lib/corkTexture';

const FRAME = 26;

/**
 * The corkboard: a framed physical object hanging on the wall, not a texture.
 *
 * The whole surface is one element with a single background stack — granules,
 * mottling, old pin holes, light and shade. Board-sized layers with
 * `mix-blend-mode` look the same and cost an entire repaint per panned frame.
 */
export function CorkSurface() {
  const tiles = useMemo(() => corkTiles(), []);

  const surface = useMemo(
    () => ({
      backgroundImage: [
        'radial-gradient(76% 60% at 24% 6%, rgba(255,242,214,0.42), rgba(255,242,214,0) 60%)',
        'radial-gradient(88% 78% at 84% 100%, rgba(52,30,10,0.34), rgba(52,30,10,0) 56%)',
        tiles.holes,
        tiles.fine,
        tiles.coarse,
        tiles.mottle,
        'linear-gradient(102deg,#ac7c45 0%,#9d6d38 38%,#a87940 68%,#946434 100%)',
      ].join(','),
      backgroundSize: [
        '100% 100%',
        '100% 100%',
        '611px 611px',
        '320px 320px',
        '487px 487px',
        '941px 941px',
        '100% 100%',
      ].join(','),
      boxShadow: 'inset 0 0 90px rgba(70,41,16,0.34), inset 0 3px 10px rgba(60,34,12,0.42)',
    }),
    [tiles],
  );

  return (
    <div
      className="board-frame absolute left-0 top-0 rounded-[14px]"
      style={{ width: BOARD_W, height: BOARD_H, padding: FRAME }}
      aria-hidden="true"
    >
      <div
        className="relative h-full w-full rounded-[4px]"
        style={{ ...surface, outline: '1px solid rgba(40,22,8,0.55)' }}
      />
    </div>
  );
}
