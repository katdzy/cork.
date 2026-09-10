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

export const TARGET_BOUNDS = {
  minX: -ROOM.halfWidth + 500,
  maxX: ROOM.halfWidth - 500,
  minY: 700,
  maxY: ROOM.height - 700,
  minZ: -400,
  maxZ: ROOM.depth * 0.55,
} as const;
