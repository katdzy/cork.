import { useMemo } from 'react';
import { BOARD_H, BOARD_W, type RoomScene } from '../../lib/types';
import { corkTiles } from '../../lib/corkTexture';

/**
 * The cork sheet itself.
 *
 * Only the cork: the frame around it is real geometry in the room now, cut
 * with actual depth so it catches the light down one edge and shades the
 * other when you swing the camera. A frame painted onto a plane goes flat the
 * moment you look at it from anywhere but straight on, which is exactly what
 * this app now lets you do.
 *
 * The whole sheet is one element with a single background stack — granules,
 * mottling, old pin holes, light and shade. Board-sized layers with
 * `mix-blend-mode` look the same and cost an entire repaint per moved frame.
 *
 * The shading is the one part of the board that has to know which room it is
 * in, because it is painted rather than lit: the shader cannot reach a DOM
 * element. So each room gets its own light on the cork, matching where its
 * light actually comes from — a window off to the right, or two shades
 * directly overhead.
 */

/** Where the light falls on the sheet, per room. */
const LIGHT: Record<RoomScene, { stack: string[]; inset: string }> = {
  kitchen: {
    stack: [
      // daylight from the window, off to the right and a little above
      'radial-gradient(78% 92% at 108% -12%, rgba(255,240,214,0.55), rgba(255,240,214,0) 66%)',
      'radial-gradient(60% 74% at 88% 6%, rgba(255,246,226,0.28), rgba(255,246,226,0) 60%)',
      // and where it runs out, into the corner of the room
      'linear-gradient(252deg, rgba(255,244,220,0.10) 0%, rgba(255,244,220,0) 30%, rgba(78,54,32,0.14) 76%, rgba(62,42,24,0.22) 100%)',
      'radial-gradient(92% 80% at 4% 110%, rgba(58,40,22,0.22), rgba(58,40,22,0) 62%)',
    ],
    inset: 'inset 0 0 80px rgba(72,44,18,0.22), inset 0 5px 12px rgba(52,30,10,0.34)',
  },
  studio: {
    stack: [
      // two shades, striking the sheet from just above its top edge
      'radial-gradient(54% 76% at 22% -10%, rgba(255,214,158,0.62), rgba(255,214,158,0) 62%)',
      'radial-gradient(54% 76% at 78% -10%, rgba(255,214,158,0.58), rgba(255,214,158,0) 62%)',
      // and the curtain wall off to the right, which is the key light now
      'radial-gradient(88% 104% at 116% 34%, rgba(226,240,255,0.30), rgba(226,240,255,0) 62%)',
      // the shade the pools run out into — no longer the dark they ran out into
      'linear-gradient(258deg, rgba(255,238,206,0.08) 0%, rgba(255,238,206,0) 30%, rgba(38,26,14,0.22) 76%, rgba(28,18,8,0.34) 100%)',
      'radial-gradient(96% 84% at 12% 120%, rgba(24,16,8,0.34), rgba(24,16,8,0) 60%)',
    ],
    inset:
      'inset 0 0 100px rgba(44,26,10,0.34), inset 0 5px 14px rgba(32,18,6,0.44), inset 0 -28px 56px rgba(26,16,6,0.3)',
  },
};

export function CorkSurface({ scene }: { scene: RoomScene }) {
  const tiles = useMemo(() => corkTiles(), []);

  const surface = useMemo(() => {
    const light = LIGHT[scene] ?? LIGHT.kitchen;
    return {
      backgroundImage: [
        ...light.stack,
        tiles.holes,
        tiles.fine,
        tiles.coarse,
        tiles.mottle,
        'linear-gradient(102deg,#b8874d 0%,#a9763f 38%,#b28247 68%,#9e6d3a 100%)',
      ].join(','),
      backgroundSize: [
        ...light.stack.map(() => '100% 100%'),
        '611px 611px',
        '320px 320px',
        '487px 487px',
        '941px 941px',
        '100% 100%',
      ].join(','),
      boxShadow: light.inset,
    };
  }, [tiles, scene]);

  return (
    <div
      className="absolute left-0 top-0"
      style={{ width: BOARD_W, height: BOARD_H, ...surface }}
      aria-hidden="true"
    />
  );
}
