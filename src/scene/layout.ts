import { BOARD_H, BOARD_W } from '../lib/types';

/**
 * The room, measured.
 *
 * Cork. hangs in the corner of a warm kitchen-office: cream plaster, a butcher
 * block counter over white shaker cabinets, a wood mail rack, a key hook rail,
 * a basket of trailing greenery, and a tall window on the right doing all the
 * lighting. That is the reference, and everything below is it in numbers.
 *
 * Units are the same board units the memories are positioned in, so the DOM
 * corkboard needs no conversion to sit in the scene — 3000 of them make a
 * metre, which puts the board at a real 1.2 × 0.8 m. Axes are three.js's: +Y
 * up, +Z out of the back wall toward the viewer, origin on the floor at the
 * middle of the wall.
 */

export const METRE = 3000;
export const cm = (n: number) => (n / 100) * METRE;

export const ROOM = {
  halfWidth: 4400,
  height: 7600,
  /* deep enough that a phone held upright has somewhere to stand back to */
  depth: 9800,
} as const;

/** Butcher block over shaker doors. The whole scene's horizon line. */
export const COUNTER = {
  top: 2760,
  thickness: 120,
  /** How far it stands out from the wall. */
  depth: 1900,
  overhang: 80,
} as const;

export const CABINET = {
  toeKick: 260,
  top: COUNTER.top - COUNTER.thickness,
  depth: COUNTER.depth - 90,
} as const;

/**
 * Where the corkboard hangs.
 *
 * Left of centre, like the stack of boards in the reference, with the wall
 * fittings filling the space to its right. `z` holds it off the plaster far
 * enough to throw a real shadow.
 */
export const BOARD = {
  width: BOARD_W,
  height: BOARD_H,
  centreX: -1150,
  bottom: 3520,
  z: 62,
  get centreY() {
    return this.bottom + this.height / 2;
  },
  get right() {
    return this.centreX + this.width / 2;
  },
} as const;

/** The mail-and-post rack, and the hook rail under it. */
export const RACK = {
  left: 980,
  width: 1620,
  bottom: 3980,
  height: 2360,
  depth: 330,
} as const;

export const HOOKS = {
  left: RACK.left,
  width: RACK.width,
  y: 3640,
  height: 250,
  depth: 96,
} as const;

/** The window: off to the right, and the reason the room is lit at all. */
export const WINDOW = {
  x: ROOM.halfWidth,
  bottom: 2960,
  top: 6980,
  near: 820,
  far: 4700,
  reveal: 150,
} as const;

/** Where a prop is allowed to be put down. */
export const DESK_BOUNDS = {
  minX: -ROOM.halfWidth + 340,
  maxX: ROOM.halfWidth - 340,
  minZ: 260,
  maxZ: COUNTER.depth - 260,
} as const;

/* -- the camera ---------------------------------------------------------- */

export interface Framing {
  fov: number;
  target: [number, number, number];
  radius: number;
  /** Azimuth, from straight-on toward the window. */
  theta: number;
  /** Polar angle from +Y. Just under a right angle, so the camera looks down. */
  phi: number;
}

/**
 * Where the camera opens, framed on the reference: the board high and left,
 * the counter running away to the right, the window just in shot. Slightly
 * above the counter and angled down, which is the only way the counter reads
 * as a surface you could put something on rather than as a stripe.
 */
export const DEFAULT_VIEW: Framing = {
  fov: 38,
  target: [-140, 3900, 460],
  radius: 8700,
  theta: 0.21,
  phi: 1.487,
};

/**
 * The same room, framed for the shape of the window it is being seen through.
 *
 * A lens wide enough to take in the whole wall on a laptop takes in about a
 * metre of it on a phone held upright, because horizontal field of view is
 * vertical field of view times the aspect ratio — and there is nowhere further
 * back to stand, the wall behind the camera being three metres away. So a
 * narrow viewport gets a wider lens and a tighter subject: the board, with the
 * counter under it, rather than the room it hangs in.
 */
export function framingFor(aspect: number): Framing {
  if (aspect >= 1.35) return DEFAULT_VIEW;
  if (aspect >= 0.95) {
    return { fov: 46, target: [-560, 4020, 380], radius: 8600, theta: 0.13, phi: 1.494 };
  }
  return {
    fov: 58,
    target: [BOARD.centreX + 120, BOARD.centreY - 640, 200],
    radius: 8500,
    theta: 0.05,
    phi: 1.508,
  };
}

/**
 * How far the camera may swing.
 *
 * The angles are generous; what actually keeps the camera honest is EYE_BOX
 * below, which is applied to the resulting *position*. Limiting angles alone
 * cannot work, because how far a given angle throws the camera depends on how
 * far out it already is — the swing that shows you the side of the mug when
 * you are close to it puts you through the wall when you are not.
 */
export const ORBIT_LIMITS = {
  minTheta: -0.95,
  maxTheta: 0.95,
  minPhi: 1.02,
  maxPhi: 1.70,
  minRadius: 700,
  maxRadius: 9600,
} as const;

/** Where the camera itself is allowed to be: inside the room, off the floor. */
export const EYE_BOX = {
  minX: -ROOM.halfWidth + 420,
  maxX: ROOM.halfWidth - 420,
  minY: 1500,
  maxY: ROOM.height - 500,
  minZ: 950,
  maxZ: ROOM.depth - 600,
} as const;

/**
 * The cork view's leash.
 *
 * Square on to the board, the camera keeps two degrees of freedom — slide and
 * zoom — and the numbers it needs are different from the room's. `margin` is
 * how far past the board's edge the frame may stray, and it exists because an
 * item is allowed to overhang the edge a little; `padding` is the sliver of
 * wall left around the board when the view first lands on it.
 *
 * `minRadius` is lower than the room's because there is nothing to bump into:
 * the camera is on the board's own axis, so the only thing between it and the
 * cork is air. It still has to clear `EYE_BOX.minZ`, which the scene folds in
 * — the board does not hang at the same depth in both rooms.
 */
export const CORK_VIEW = {
  margin: 190,
  padding: 1.05,
  /** How far back the view may be pulled before the board stops being the subject. */
  pullback: 1.3,
  /**
   * The least of the frame's height the board may take up when the view lands.
   *
   * "Fit the whole board" is the obvious rule and it is the wrong one on a
   * phone held upright. The board is half again as wide as it is tall and the
   * screen is twice as tall as it is wide, so fitting its width puts the
   * camera far enough back that the board covers under a third of the height
   * and everything pinned to it is four millimetres across — a view of a board
   * rather than a view for working on one, and barely closer than the room it
   * was entered from.
   *
   * So the pullback stops here and the rest is left to the pan. On anything
   * wider than about four to three the whole board fits inside this anyway and
   * the cap never binds; it is a floor under the worst shape, not a framing
   * rule in its own right.
   */
  minFill: 0.62,
  minRadius: 900,
} as const;

export const TARGET_BOUNDS = {
  minX: -ROOM.halfWidth + 500,
  maxX: ROOM.halfWidth - 500,
  minY: 700,
  maxY: ROOM.height - 700,
  minZ: -400,
  maxZ: ROOM.depth * 0.55,
} as const;
