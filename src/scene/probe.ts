import * as THREE from 'three';

/**
 * The room, reflected — captured once from a point inside it.
 *
 * Reflections are the other half of what a rasteriser cannot do. Screen-space
 * reflections can only show you what is already on screen, which is why they
 * tear away at the edges of the frame and vanish on anything facing the
 * camera; real ones mean tracing a second ray per pixel per frame. Both are
 * answering, for every pixel, every frame, a question whose answer for a room
 * that never moves is a constant.
 *
 * So it is captured as a constant: six faces from a point in the middle of the
 * room, prefiltered into the roughness pyramid a physically based material
 * samples. After that every mullion, cup pull, screen and pane of glass is
 * reflecting the actual room it is standing in — the actual window, the actual
 * city — at no cost per frame whatsoever.
 *
 * The lie is the single capture point: strictly, the reflection is only
 * correct for something standing exactly where the probe was. In a room this
 * size, on surfaces this rough, that error is far smaller than the error of
 * reflecting a generic grey box, which is the alternative.
 */

export interface Probe {
  texture: THREE.Texture;
  dispose(): void;
}

let neutral: THREE.WebGLRenderTarget | null = null;

/**
 * Somewhere for the first capture's metal to look at.
 *
 * Capturing a room whose materials have no environment leaves every metal
 * surface in the capture black, and that black is then what the metal in the
 * room reflects. A plain sky-to-floor gradient standing in for the world costs
 * a thirty-two pixel canvas and breaks the circularity.
 */
function neutralEnvironment(pmrem: THREE.PMREMGenerator): THREE.Texture {
  if (neutral) return neutral.texture;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 16);
  g.addColorStop(0, '#c3ccd6');
  g.addColorStop(0.5, '#8c8781');
  g.addColorStop(1, '#4a423a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 16);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  neutral = pmrem.fromEquirectangular(t);
  t.dispose();
  return neutral.texture;
}

export function captureProbe(
  renderer: THREE.WebGLRenderer,
  pmrem: THREE.PMREMGenerator,
  scene: THREE.Scene,
  at: THREE.Vector3Like,
  size: number,
  /** Anything that moves, and so has no business being baked into a mirror. */
  exclude: THREE.Object3D[],
  /** Two passes puts the room's own reflections into what it reflects. */
  passes = 1,
): Probe {
  const hidden = exclude.map((o) => [o, o.visible] as const);
  for (const o of exclude) o.visible = false;

  const previous = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  scene.environment = neutralEnvironment(pmrem);
  scene.environmentIntensity = 1;

  let out: THREE.WebGLRenderTarget | null = null;
  for (let pass = 0; pass < passes; pass++) {
    const target = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    /*
     * Near and far are the room's, not the camera's. The probe stands inside
     * the room looking out at walls a couple of metres away, so a near plane
     * pushed out for the orbit camera's depth precision would clip them.
     */
    const cube = new THREE.CubeCamera(20, 40000, target);
    cube.position.set(at.x, at.y, at.z);
    cube.update(renderer, scene);

    const filtered = pmrem.fromCubemap(target.texture);
    target.dispose();
    out?.dispose();
    out = filtered;
    // the next pass reflects this one, which is what a second bounce is
    scene.environment = filtered.texture;
  }

  scene.environment = previous;
  scene.environmentIntensity = previousIntensity;
  for (const [o, was] of hidden) o.visible = was;

  const target = out!;
  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}

/** Dropped when the last renderer goes; it belongs to that renderer's PMREM. */
export function disposeNeutral() {
  neutral?.dispose();
  neutral = null;
}
