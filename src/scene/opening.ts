import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildRoom } from './buildRoom';
import { buildCorkboard } from './buildFittings';
import { kitchenLight, SCENES, disposeScene } from './themes';
import { BOARD } from './layout';
import { box, still } from './parts';
import { concrete, plaster } from './textures';
import { quality } from './quality';
import { bakeLight, mergeStatic } from './bake';
import { OPENING } from './openingTiming';
import { buildOpeningHands } from './openingHands';
import { buildRubbish } from './rubbish';

const ease = (t: number) => { const p = THREE.MathUtils.clamp(t, 0, 1); return p * p * p * (p * (p * 6 - 15) + 10); };
const mix = THREE.MathUtils.lerp;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A person's eye line, with hands attached to the board they are carrying.
 * Shared room maps are borrowed; only opening-owned resources are disposed. */
export function createOpening(host: HTMLElement) {
  const q = quality();
  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: q.powerPreference });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = q.shadowType;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(54, 1, 25, 70000);
  const street = new THREE.Group(); street.name = 'outside';
  const home = new THREE.Group(); home.name = 'kitchen-without-props';
  const shell = buildRoom();
  home.add(shell, kitchenLight());
  const board = buildCorkboard();
  scene.add(street, home, board);
  let disposed = false;
  let seconds = 0;

  const material = (color: number, roughness = 0.9, maps = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...maps });
  const masonry = material(0x999c91, 0.97, plaster());
  const pavement = material(0xfbfbf6, 0.93, concrete());
  street.add(box(28000, 180, 35000, pavement, 0, -120, 11000));
  street.add(box(26000, 10000, 300, masonry, 0, 4800, -1300));
  street.add(box(26000, 180, 740, material(0xe6e8de, 0.95, concrete()), 0, 0, -900));
  /* Recessed masonry joints, drain pipe, and a weathered service door.
     Two hundred joints is two hundred draw calls for two thousand triangles,
     which is the wrong way round on a phone; they never move relative to each
     other, so they go up the wall as one mesh. */
  const joints: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 12; row++) {
    joints.push(new THREE.BoxGeometry(26000, 12, 8).translate(0, row * 760, -1145));
    for (let col = 0; col < 16; col++) {
      joints.push(new THREE.BoxGeometry(12, 750, 8)
        .translate(col * 1700 - 13000 + (row % 2) * 850, row * 760 + 380, -1145));
    }
  }
  street.add(still(new THREE.Mesh(mergeGeometries(joints), material(0x676e64))));
  joints.forEach((g) => g.dispose());
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(95, 95, 9500, 20), material(0x535f58, 0.65));
  pipe.position.set(5100, 4600, -960); pipe.castShadow = true; street.add(pipe);
  street.add(box(2500, 6600, 120, material(0x536259, 0.8, plaster()), -7200, 3300, -1080));
  street.add(buildRubbish());
  const daylight = new THREE.DirectionalLight(0xffe5bb, 3.2);
  daylight.position.set(-6200, 12000, 7500); daylight.target.position.set(0, 700, 500);
  daylight.castShadow = true; daylight.shadow.mapSize.setScalar(q.sunShadow);
  Object.assign(daylight.shadow.camera, { left: -10000, right: 10000, top: 11000, bottom: -7000, near: 100, far: 35000 });
  daylight.shadow.camera.updateProjectionMatrix(); daylight.shadow.normalBias = 15; daylight.shadow.bias = -0.0002;
  street.add(daylight, daylight.target, new THREE.HemisphereLight(0xdce6ef, 0x80745e, 1.1));

  const limbs = buildOpeningHands();
  board.add(limbs.hands);
  scene.add(limbs.arms);

  // Own the reflection targets, but never clear the main room's texture cache.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const neutralScene = new RoomEnvironment();
  const outdoorEnvironment = pmrem.fromScene(neutralScene); neutralScene.dispose();
  let indoorEnvironment: THREE.WebGLRenderTarget | undefined;
  const captureKitchen = () => {
    if (disposed) return;
    const wasHome = home.visible; const wasStreet = street.visible; const wasBoard = board.visible;
    home.visible = true; street.visible = false; board.visible = false;
    scene.background = new THREE.Color(SCENES.kitchen.background);
    scene.environment = outdoorEnvironment.texture; scene.environmentIntensity = 0.62;
    const cubeTarget = new THREE.WebGLCubeRenderTarget(q.probe, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(20, 40000, cubeTarget); cube.position.set(-200, 3700, 1500); cube.update(renderer, scene);
    indoorEnvironment?.dispose(); indoorEnvironment = pmrem.fromCubemap(cubeTarget.texture); cubeTarget.dispose();
    home.visible = wasHome; street.visible = wasStreet; board.visible = wasBoard;
  };
  captureKitchen();
  bakeLight(shell, { rayBudget: q.rayBudget, settled: () => {
    if (disposed) return;
    mergeStatic(shell); captureKitchen(); render(seconds);
  } });

  const groundBoard = v(0, 1300, 400);
  const carriedBoard = new THREE.Vector3();

  /** How far in front of the eyes the board is carried, which is further than
   *  an arm reaches: it has to fit in the shot. */
  const hold = (mobile: boolean) => (mobile ? 5100 : 3100);

  interface Body { eye: THREE.Vector3; look: THREE.Vector3; moving: number; stand: number }
  const make = (): Body => ({ eye: new THREE.Vector3(), look: new THREE.Vector3(), moving: 0, stand: 0 });
  const now = make();
  const before = make();

  /**
   * Where the body is, written as a function of time and nothing else.
   *
   * Which is the point: it can be sampled twice. The camera takes the answer
   * for now and the board takes the answer for a tenth of a second ago, and
   * that single difference is most of what makes a carried board feel heavy —
   * it follows where the body was rather than where it is, swings wide when
   * the walk turns, and settles behind it when the walk stops. A spring
   * integrated frame by frame would do the same thing and would break the
   * moment the reader scrubbed, paused, or turned their phone; this cannot,
   * because every frame is derived from its own timestamp.
   */
  function bodyAt(time: number, mobile: boolean, out: Body) {
    if (time < OPENING.home) {
      const approach = ease((time - 0.6) / 5.4);
      const crouch = ease((time - 6) / 2.4);
      const stand = ease((time - 9) / 2.5);
      const walk = ease((time - 12) / 4);
      const moving = Math.sin(approach * Math.PI) * (1 - crouch) + Math.sin(walk * Math.PI);
      const bob = Math.sin(time * 4.4) * 9 * moving;
      out.eye.set(
        mix(1400, 0, approach) + walk * 850,
        mix(5000, 3450, crouch) + stand * 1550 + bob,
        mix(11200, mobile ? 6700 : 5400, approach) + walk * 2000,
      );
      out.look.set(
        mix(1100, 0, ease((time - 0.4) / 3)) + walk * 1100,
        mix(3000, 1750, ease((time - 1) / 4)) + stand * 1800,
        300 + walk * 600,
      );
      out.moving = moving;
      out.stand = stand;
      return out;
    }
    const enter = ease((time - 16) / 2.4);
    const hang = ease((time - 18.5) / 3.5);
    const stepBack = ease((time - 23.3) / 3.7);
    const moving = Math.sin(enter * Math.PI);
    out.eye.set(
      mix(400, BOARD.centreX, enter),
      5050 + Math.sin(time * 4.4) * 7 * moving,
      mix(8600, mobile ? 6400 : 4200, enter),
    );
    out.look.set(mix(-200, BOARD.centreX, enter), mix(4000, BOARD.centreY - 300, hang), BOARD.z);
    const framing = SCENES.kitchen.framing(camera.aspect);
    const finalTarget = v(...framing.target);
    const finalEye = finalTarget.clone().add(v(
      framing.radius * Math.sin(framing.phi) * Math.sin(framing.theta),
      framing.radius * Math.cos(framing.phi),
      framing.radius * Math.sin(framing.phi) * Math.cos(framing.theta),
    ));
    finalEye.y = 4950;
    out.eye.lerp(finalEye, stepBack);
    out.look.lerp(finalTarget, stepBack);
    out.moving = moving;
    out.stand = 1;
    return out;
  }

  const right = new THREE.Vector3();
  const upward = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  function render(time: number) {
    seconds = time;
    const indoors = time >= OPENING.home;
    const mobile = camera.aspect < 0.8;
    camera.fov = mobile ? 78 : 54;
    home.visible = indoors; street.visible = !indoors;
    scene.background = new THREE.Color(indoors ? SCENES.kitchen.background : 0xb7b9ac);
    scene.environment = indoors ? indoorEnvironment!.texture : outdoorEnvironment.texture;
    scene.environmentIntensity = indoors ? SCENES.kitchen.envIntensity : 0.42;
    renderer.toneMappingExposure = indoors ? SCENES.kitchen.exposure : 0.92;

    bodyAt(time, mobile, now);
    bodyAt(time - 0.11, mobile, before);
    camera.position.copy(now.eye);
    camera.lookAt(now.look);
    camera.rotateZ(Math.sin(time * 2.2) * 0.0015 * now.moving);

    const reach = ease((time - 6.5) / 1.4);
    const release = ease((time - 22) / 1.7);
    const grip = ease((time - 7.3) / 1.5) * (1 - release);
    const hanging = ease((time - 18.5) / 3.5);

    /* The board: on the ground, then in front of the body it was lifted by,
       then on the wall. It is placed from where the body was a moment ago, so
       that the arms are what take up the difference. */
    carriedBoard.set(
      before.eye.x,
      before.eye.y - 1050 + Math.sin(time * 4.4 - 0.3) * 8 * before.moving,
      before.eye.z - hold(mobile),
    );
    if (!indoors) {
      board.position.copy(groundBoard).lerp(carriedBoard, now.stand);
      board.rotation.set(
        mix(-0.16, -0.2, now.stand),
        mix(0.05, 0, now.stand),
        mix(-0.065, 0.012 * Math.sin(time * 2) * now.moving, now.stand),
      );
    } else {
      board.position.copy(carriedBoard).lerp(v(BOARD.centreX, BOARD.centreY, BOARD.z), hanging);
      board.rotation.set(-0.2 * (1 - hanging), 0, 0.02 * (1 - hanging));
    }

    limbs.show(time > 6.2 && time < 24.4);
    if (limbs.arms.visible) {
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      upward.setFromMatrixColumn(camera.matrixWorld, 1);
      ahead.setFromMatrixColumn(camera.matrixWorld, 2).negate();
      limbs.pose({
        board, eye: camera.position, right, up: upward, forward: ahead,
        reach, grip, release, time, moving: now.moving,
      });
    }

    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  const resize = () => {
    const width = host.clientWidth; const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height; camera.fov = camera.aspect < 0.8 ? 78 : 54;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio, Math.sqrt(q.maxPixels / Math.max(1, width * height))));
    renderer.setSize(width, height); render(seconds);
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return {
    render,
    dispose() {
      disposed = true; observer.disconnect();
      // buildRoom's window image is uncached and belongs to this instance.
      shell.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial) o.material.map?.dispose();
      });
      scene.traverse((o) => { if (o instanceof THREE.Light && 'shadow' in o) (o as THREE.DirectionalLight).shadow.dispose(); });
      disposeScene(street); disposeScene(home); disposeScene(board); disposeScene(limbs.arms);
      outdoorEnvironment.dispose(); indoorEnvironment?.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
