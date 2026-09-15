/** Shared by the camera choreography and its accessible chapter controls. */
export const OPENING = { pickup: 6, home: 16, duration: 30 } as const;

/** Wall placement beats, shared by the board, head and hands. */
export const PLACEMENT = {
  lift: 18.35,
  inspect: 19.35,
  align: 20.05,
  press: 20.8,
  lower: 21.5,
  release: 22.2,
  seat: 23.15,
  stepBack: 24,
  cameraHome: 27,
  crossfade: 27,
} as const;
