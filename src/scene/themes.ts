import * as THREE from 'three';
import { BOARD, COUNTER, DESK_BOUNDS, ROOM, WINDOW, type Framing } from './layout';
import { buildRoom } from './buildRoom';
import { buildFittings } from './buildFittings';
import { buildStudio, STUDIO_BOARD, STUDIO_DESK, STUDIO_GLAZING } from './buildStudio';
import { bloom, lightPool, shaft } from './parts';
import { bakeLight, mergeStatic } from './bake';
import { quality } from './quality';
import { lightWidth } from './softShadows';
import type { Grade } from './post';
import type { RoomScene } from '../lib/types';

/**
 * The two rooms the board can hang in.
 *
 * Same board, same memories, same desk you arranged — a different place to
 * stand. Everything that differs between them lives here: where the board
 * hangs, how the camera opens on it, how bright the room is, and what gets
 * built into it.
 */

export type SceneId = RoomScene;

export interface SceneDef {
  id: SceneId;
  label: string;
  /** One line, for the control that switches to it. */
  blurb: string;
  background: number;
  /** How the wall behind the WebGL canvas is painted before the first frame. */
  pageColour: string;
  exposure: number;
  envIntensity: number;
  board: { centreX: number; centreY: number; z: number };
  /** Where a dragged prop may be put down — the two desks aren't the same. */
  deskBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  framing(aspect: number): Framing;
  /** `settled` fires when the traced light has landed, a moment after this
   *  returns — which is the scene's cue to draw the room again. */
  build(settled: () => void): THREE.Group;
  /** Where the reflection probe stands, roughly where a person would. */
  probeAt: [number, number, number];
  /**
   * The opening the daylight comes through, and what colour it arrives.
   *
   * The scattering pass in `post.ts` marches outward from this point, so it
   * wants the middle of the bright thing rather than the position of the sun
   * — the sun is outside and never in shot, and bands of light do not appear
   * to radiate from a light you cannot see. They radiate from the window.
   */
  scatterFrom: [number, number, number];
  scatterTint: number;
  /**
   * The light that actually falls on the board, in world space.
   *
   * Not for the renderer — it already has the real lights. This is for the
   * corkboard, which is not rendered by the renderer at all: it is live DOM
   * on a CSS3D layer, and a browser has no idea there is a window to its
   * right. So the scene projects this point every time the camera moves and
   * hands the board the screen direction it came from, and the board's own
   * shadows, sheen and edges are drawn from that.
   *
   * It is the difference between a photograph pinned to a wall in a room and
   * a photograph pinned to a wall in a stylesheet. See `--cast-x` in
   * `index.css`.
   */
  keyLight: [number, number, number];
  /**
   * And what the photograph of it should feel like — see `Grade` in `post.ts`.
   *
   * Everything above this line is the room being correct about light.
   * This is the separate question of the hour, the weather and the stock, and
   * it is kept separate because it moves for entirely different reasons: a
   * mullion moves because the room changed, and a grade moves because
   * somebody wanted the room to feel quieter.
   */
  grade: Grade;
}

/**
 * Everything a finished room gets on its way out of the door.
 *
 * Trace it, then fold it. The order matters: the bake reads each mesh's own
 * world matrix to put its vertices where they really are, and the merge then
 * writes those matrices into the vertices for good, so running them the other
 * way round would leave the trace with nothing to distinguish one cabinet door
 * from the next. Both happen once per room per session — the built room is
 * kept across a switch rather than rebuilt — which is what makes it affordable
 * to spend a hundred and fifty thousand rays on a room.
 */
function finish(group: THREE.Group, settled: () => void): THREE.Group {
  bakeLight(group, {
    rayBudget: quality().rayBudget,
    settled: () => {
      mergeStatic(group);
      settled();
    },
  });
  return group;
}

/* --------------------------------------------------------------- kitchen */

/**
 * The window, doing nearly all of it.
 *
 * A shadow camera's bounds are only picked up by `updateProjectionMatrix`,
 * which three.js does not call for you — set them and forget it and the
 * frustum stays at its ten-unit default, which in a room measured in
 * thousands contains nothing at all. Everything then renders with no
 * shadows and no error, looking merely flat.
 */
export function kitchenLight() {
  const g = new THREE.Group();
  const sun = new THREE.DirectionalLight(0xfff0d8, 4.6);
  sun.position.set(WINDOW.x + 4200, WINDOW.top + 2600, (WINDOW.near + WINDOW.far) / 2 + 3400);
  sun.target.position.set(-900, 3300, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(quality().sunShadow);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 34;
  const sc = sun.shadow.camera;
  sc.left = -7600;
  sc.right = 7600;
  sc.top = 6800;
  sc.bottom = -5200;
  sc.near = 2000;
  sc.far = 24000;
  sc.updateProjectionMatrix();
  /*
   * And how wide the light is, which is what decides how soft its shadows
   * get — see `softShadows.ts`.
   *
   * Four centimetres, which is the sun.
   *
   * Not the window — the window is a metre and a half across, and a light
   * that size dissolves the patch of sunlight lying across the wall, which is
   * the thing the whole room is composed around. The sun subtends half a
   * degree from here, so what it throws at four metres has a penumbra of
   * about four centimetres, and at four millimetres — a photograph standing
   * off the cork — of essentially nothing.
   *
   * That spread is small and it is the entire effect. Every shadow in the
   * room is now sharp where its object touches something and loses its edge
   * as it travels, which is the difference between objects standing on a
   * worktop and objects printed on one. The sky's much larger contribution is
   * not a shadow at all; it is the hemisphere light and the traced bake,
   * which is where it belongs.
   */
  lightWidth(sun.shadow, 115);
  g.add(sun, sun.target);

  /*
   * The sky the window sees, and the bounce off the oak floor.
   *
   * Briefly turned down, on the theory that a room with less ambient in it
   * would read as deeper. It read as unlit. These two are what keep the half
   * of the room the window cannot reach from being a hole, and a hole is not
   * a shadow — it is an absence of information, and the eye tells the
   * difference instantly.
   */
  g.add(new THREE.HemisphereLight(0xd9e6f5, 0xa87f52, 0.42));
  // and the rest of the room, which the window can only reach indirectly
  const fill = new THREE.PointLight(0xffe0bb, 4.2e6, 0, 1.7);
  fill.position.set(-3400, 5400, 5600);
  g.add(fill);

  // daylight blowing out around the reveal — the same fake bloom the studio
  // uses on its shades, turned right down
  const flare = bloom(0xfff3dc, 2200, 6200, 0.5);
  flare.position.set(WINDOW.x - 200, (WINDOW.bottom + WINDOW.top) / 2, (WINDOW.near + WINDOW.far) / 2);
  g.add(flare);

  /*
   * And the beam itself, which is the one thing in the room that is neither
   * surface nor light but the air between them.
   *
   * Traced directly, this is a volumetric: march the depth buffer toward the
   * sun, sampling the shadow map at every step, once per pixel per frame. Here
   * the sun does not move and neither does the window, so the beam it makes is
   * a constant — two crossed cards standing where the light goes, and the
   * patch of sun they end in laid on the butcher block where it lands.
   */
  if (quality().shafts) {
    const from = new THREE.Vector3(WINDOW.x, (WINDOW.bottom + WINDOW.top) / 2, (WINDOW.near + WINDOW.far) / 2);
    const towards = new THREE.Vector3().copy(sun.target.position).sub(sun.position).normalize();
    // as far as the counter, where it lands, and no further
    const reach = (from.y - COUNTER.top) / -towards.y;
    /*
     * Kept short, and kept faint.
     *
     * A card is a flat thing, and where one passes through a wall the depth
     * test cuts it off along a dead straight line that nothing in the air
     * would ever do. The only real defence is to put it where there is no wall
     * — the open span between the reveal and the worktop — and to keep it dim
     * enough that the eye reads air rather than acetate. This one is barely
     * there, which is the correct amount for a beam of sunlight in a room
     * whose dust you cannot see.
     */
    g.add(shaft(from.clone().addScaledVector(towards, 200), towards, reach * 0.95, 2100, 0xffeccd, 0.34));
    g.add(
      lightPool(
        from.clone().addScaledVector(towards, reach).setY(COUNTER.top + 4),
        2600,
        2000,
        0xffdfb2,
        0.42,
      ),
    );
  }
  return g;
}

const KITCHEN: SceneDef = {
  id: 'kitchen',
  label: 'Kitchen',
  blurb: 'Cream plaster, butcher block, one big window',
  background: 0xe6dccd,
  pageColour: '#ece7de',
  exposure: 0.98,
  /*
   * Higher than it was, because what it is an intensity of has changed.
   *
   * This used to scale three.js's generic grey room, which is an evenly lit
   * box and therefore brighter than any real interior. Scaling a capture of
   * this kitchen instead means scaling something with a window at one end and
   * a shaded corner at the other — dimmer on average, and correct in a way the
   * grey box never was. The number went up so that the light stayed put.
   */
  envIntensity: 0.62,
  board: { centreX: BOARD.centreX, centreY: BOARD.centreY, z: BOARD.z },
  deskBounds: DESK_BOUNDS,
  framing(aspect) {
    if (aspect >= 1.35) return { fov: 38, target: [-140, 3900, 460], radius: 8700, theta: 0.21, phi: 1.487 };
    if (aspect >= 0.95) return { fov: 46, target: [-560, 4020, 380], radius: 8600, theta: 0.13, phi: 1.494 };
    return {
      fov: 58,
      target: [BOARD.centreX + 120, BOARD.centreY - 640, 200],
      radius: 8500,
      theta: 0.05,
      phi: 1.508,
    };
  },
  probeAt: [-200, 3700, 1500],
  scatterFrom: [WINDOW.x - 300, (WINDOW.bottom + WINDOW.top) / 2 + 400, (WINDOW.near + WINDOW.far) / 2],
  scatterTint: 0xffe9c6,
  // the sun itself, out through the window and well above the head of it
  keyLight: [WINDOW.x + 4200, WINDOW.top + 2600, (WINDOW.near + WINDOW.far) / 2 + 3400],
  /*
   * Late afternoon, and only one window.
   *
   * Colour, and nothing else. The curve is at unity and the corners barely
   * fall away, because every attempt to use this to deepen the room ended
   * with a room that had no shape in it — which is the one thing worse than
   * a flat one. What is left is the honest reason a kitchen at this hour
   * looks the way it does: everything the sun touches is amber, having come
   * through four metres more atmosphere than it did at noon, and everything
   * it does not touch is lit by the *sky* through the same window, which is
   * blue. Two lights, two colours. Pulling them apart by a few per cent
   * costs no brightness at all and is most of what stops a rendered room
   * looking like one.
   */
  grade: { contrast: 1.0, saturation: 1.0, split: 0.4, shade: 0x7b7f8b, glow: 0x8a8177, vignette: 0.26 },
  build(settled) {
    const g = new THREE.Group();
    g.add(buildRoom(), buildFittings(), kitchenLight());
    return finish(g, settled);
  },
};

/* ---------------------------------------------------------------- studio */

const STUDIO: SceneDef = {
  id: 'studio',
  label: 'Studio',
  blurb: 'Concrete and glass, high up, late afternoon',
  background: 0x2c2e31,
  pageColour: '#26282a',
  exposure: 1.16,
  // as above, and more so: a concrete room at dusk is a dark thing to reflect
  envIntensity: 0.95,
  board: { ...STUDIO_BOARD },
  deskBounds: {
    minX: STUDIO_DESK.left + 320,
    maxX: STUDIO_DESK.right - 340,
    minZ: DESK_BOUNDS.minZ,
    maxZ: DESK_BOUNDS.maxZ,
  },
  framing(aspect) {
    const cx = STUDIO_BOARD.centreX;
    // opened a little wider than the kitchen, so the glazing down one side and
    // the doorway down the other both make it into the frame
    if (aspect >= 1.35) return { fov: 43, target: [cx + 60, 3860, 660], radius: 9000, theta: 0.02, phi: 1.5 };
    if (aspect >= 0.95) return { fov: 45, target: [cx, 4160, 440], radius: 8400, theta: 0.02, phi: 1.5 };
    return { fov: 57, target: [cx, STUDIO_BOARD.centreY - 560, 240], radius: 8400, theta: 0.01, phi: 1.506 };
  },
  probeAt: [STUDIO_BOARD.centreX, 3900, 1800],
  /* The curtain wall, not the pendants: the glazing is the key light here and
     the one thing in the room bright enough to throw anything through the air.
     Cooler than the kitchen's, because what comes through it is a city at
     dusk rather than an afternoon. */
  scatterFrom: [STUDIO_GLAZING.x, STUDIO_GLAZING.y, STUDIO_GLAZING.z],
  scatterTint: 0xffe2c0,
  /* The pendants, not the glazing. The board here hangs under two shades a
     metre above it and the glass is side-on to it; what throws a shadow off a
     pinned photograph is the thing overhead. */
  keyLight: [STUDIO_BOARD.centreX, STUDIO_BOARD.centreY + 3400, STUDIO_BOARD.z + 2600],
  /*
   * Dusk, concrete, and two hot little lamps.
   *
   * Harder than the kitchen on every count. The contrast is higher because
   * there is nothing soft in the room to bounce anything; the colour is
   * pulled further out because a concrete floor at this hour genuinely has
   * very little in it; and the split is wide, because the two light sources
   * here are not variations on one another — they are tungsten at two
   * thousand seven hundred kelvin and a city sky at nine thousand, in the
   * same shot. Standing between them is the whole reason to be in this room.
   */
/* Lighter still than the kitchen's, and for the reason that took two goes to
     learn: a room that is already dark has no headroom to be darkened. Every
     number that deepens a bright room lands here on top of one that is mostly
     shadow to begin with, and the first thing to go is the shape of the far
     side of it — the concrete, the chair, the whole left half. What this room
     wants from a grade is its colour and none of its weight: two lamps hot and
     amber against a wall of glass gone blue. */
  grade: { contrast: 1.0, saturation: 0.98, split: 0.4, shade: 0x797d8e, glow: 0x8d8074, vignette: 0.16 },
  build: (settled) => finish(buildStudio(), settled),
};

export const SCENES: Record<SceneId, SceneDef> = { kitchen: KITCHEN, studio: STUDIO };
export const SCENE_ORDER: readonly SceneId[] = ['kitchen', 'studio'];
export const DEFAULT_SCENE: SceneId = 'kitchen';

/**
 * Free a swapped-out room. Textures are shared and cached, so they stay.
 *
 * Materials are optional because the props do not own theirs: a handful of
 * module-level materials are shared across every mug, pot and laptop, and
 * disposing those on teardown would leave the next mount — StrictMode's second
 * pass, or a hot reload — building its room out of freed programs.
 */
export function disposeScene(group: THREE.Group, materials = true) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (!materials) return;
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

export { ROOM };
