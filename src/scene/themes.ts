import * as THREE from 'three';
import { BOARD, DESK_BOUNDS, ROOM, WINDOW, type Framing } from './layout';
import { buildRoom } from './buildRoom';
import { buildFittings } from './buildFittings';
import { buildStudio, STUDIO_BOARD, STUDIO_DESK } from './buildStudio';
import { bloom } from './parts';
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
  build(): THREE.Group;
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
  sun.shadow.mapSize.set(1536, 1536);
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
  return g;
}

const KITCHEN: SceneDef = {
  id: 'kitchen',
  label: 'Kitchen',
  blurb: 'Cream plaster, butcher block, one big window',
  background: 0xe6dccd,
  pageColour: '#ece7de',
  exposure: 0.94,
  envIntensity: 0.34,
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
  build() {
    const g = new THREE.Group();
    g.add(buildRoom(), buildFittings(), kitchenLight());
    return g;
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
  envIntensity: 0.42,
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
  build: buildStudio,
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
