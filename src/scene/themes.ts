import * as THREE from 'three';
import { BOARD, COUNTER, DESK_BOUNDS, ROOM, WINDOW, type Framing } from './layout';
import { buildRoom } from './buildRoom';
import { buildFittings } from './buildFittings';
import { buildStudio, STUDIO_BOARD, STUDIO_DESK } from './buildStudio';
import { bloom, lightPool, shaft } from './parts';
import { bakeLight, mergeStatic } from './bake';
import { quality } from './quality';
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
function kitchenLight() {
  const g = new THREE.Group();
  const sun = new THREE.DirectionalLight(0xfff0d8, 4.6);
  sun.position.set(WINDOW.x + 4200, WINDOW.top + 2600, (WINDOW.near + WINDOW.far) / 2 + 3400);
  sun.target.position.set(-900, 3300, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(quality().sunShadow);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 34;
  sun.shadow.radius = 2.4;
  const sc = sun.shadow.camera;
  sc.left = -7600;
  sc.right = 7600;
  sc.top = 6800;
  sc.bottom = -5200;
  sc.near = 2000;
  sc.far = 24000;
  sc.updateProjectionMatrix();
  g.add(sun, sun.target);

  // the sky the window sees, and the bounce off the oak floor
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
  exposure: 0.94,
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
  exposure: 0.98,
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
