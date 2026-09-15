import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildRoom } from './buildRoom';
import { buildCorkboard } from './buildFittings';
import { kitchenLight, SCENES, disposeScene } from './themes';
import { BOARD, WINDOW } from './layout';
import { box, still } from './parts';
import { concrete, plaster } from './textures';
import { quality } from './quality';
import { createPost } from './post';
import { installSoftShadows, lightWidth } from './softShadows';
import { bakeLight, mergeStatic } from './bake';
import { OPENING, PLACEMENT } from './openingTiming';
import { buildOpeningHands } from './openingHands';
import { openingMotion } from './openingMotion';
import { buildRubbish } from './rubbish';

/** The alley: overcast, unheated, and nobody's idea of anywhere. */
const STREET_GRADE = { contrast: 1.0, saturation: 0.9, split: 0.4, shade: 0x7c8086, glow: 0x83817d, vignette: 0.22 };

const ease = (t: number) => { const p = THREE.MathUtils.clamp(t, 0, 1); return p * p * p * (p * (p * 6 - 15) + 10); };
const mix = THREE.MathUtils.lerp;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A person's eye line, with hands attached to the board they are carrying.
 * Shared room maps are borrowed; only opening-owned resources are disposed. */
export function createOpening(host: HTMLElement) {
  const q = quality();
  // antialias off where the post chain owns the samples instead — see `post.ts`
  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias && !q.post, powerPreference: q.powerPreference });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = installSoftShadows();
  host.appendChild(renderer.domElement);
  /*
   * The prologue gets the same lens the room does, and wants it more.
   *
   * This is the one part of the app that is unambiguously a shot rather than
   * an interface: a held camera, a walk in from the street, a doorway
   * several stops brighter than the hall behind it. Every one of those is a
   * situation where a real lens does something visible and a clipped buffer
   * does nothing at all — the doorway simply goes white and stays white.
   */
  const post = createPost(renderer);
  const scene = new THREE.Scene();
  /*
   * Near and far, chosen the way the room's are — for depth precision.
   *
   * This opened at twenty-five and seventy thousand, a ratio of two thousand
   * eight hundred. A depth buffer spends almost all of its resolution close to
   * the camera, and what is left out where the scene actually is falls off
   * with that ratio; `useRoomScene` had already found that six hundred and
   * sixty-seven was enough to leave drawer faces fighting each other for the
   * same depth value. Four times worse, over a pavement thirty-five metres
   * long seen almost edge-on, put the fight across the whole ground: even
   * bands of it, closing up towards the horizon, wherever two triangles
   * rounded to the same number.
   *
   * Five hundred is as far out as the near plane can go here. Unlike the room
   * camera, which is leashed away from everything, this one is a person's eye
   * with their own arms attached to it — the shoulders sit *behind* it and the
   * upper arms only come into shot about sixteen hundred units out, so there
   * is room to push the plane to five hundred and none at all to push it to
   * two thousand. That still buys a factor of twenty.
   */
  const camera = new THREE.PerspectiveCamera(54, 1, 500, 70000);
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
  // poured flat and walked on: no shuttering, so none of a wall's marks
  const pavement = material(0xfbfbf6, 0.93, concrete(false));
  street.add(box(28000, 180, 35000, pavement, 0, -120, 11000));
  street.add(box(26000, 10000, 300, masonry, 0, 4800, -1300));
  street.add(box(26000, 180, 740, material(0xe6e8de, 0.95, concrete(false)), 0, 0, -900));
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
  /* Wider than either room's sun: this one is outdoors, where half the light
     arriving on a bin bag has come off the sky and the wall behind it rather
     than straight from overhead. Softer shadows on the rubbish is most of what
     makes the pile read as rubbish rather than as a heap of boxes. */
  lightWidth(daylight.shadow, 300);
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

  /* The sun, put where a sun is: far enough away along the light's own
     direction that it reads as being in the sky rather than in the street. */
  const outdoorScatter = daylight.target.position.clone()
    .addScaledVector(daylight.position.clone().sub(daylight.target.position).normalize(), 46000);
  const indoorScatter = v(WINDOW.x - 300, (WINDOW.bottom + WINDOW.top) / 2 + 400, (WINDOW.near + WINDOW.far) / 2);

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
      const crouch = ease((time - 6) / 1.8);
      const stand = ease((time - 8.8) / 1.85);
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
      // Notice the discarded board, look along its edge, then commit to
      // the pickup. The eyes lead the crouch instead of moving in lockstep.
      const notice = ease((time - 3.1) / 0.45) * (1 - ease((time - 5.6) / 0.6));
      out.look.x += notice * mix(-260, 150, ease((time - 4.3) / 0.65));
      out.look.y += notice * 110;
      out.moving = moving;
      out.stand = stand;
      return out;
    }
    const enter = ease((time - 16) / 2.4);
    const lift = ease((time - PLACEMENT.lift) / 0.95);
    const check = ease((time - PLACEMENT.inspect) / 0.35)
      * (1 - ease((time - PLACEMENT.press) / 0.65));
    const glance = mix(-380, 340, ease((time - PLACEMENT.align) / 0.5)) * check;
    const lean = ease((time - PLACEMENT.press + 0.2) / 0.65)
      * (1 - ease((time - PLACEMENT.release) / 0.6));
    const stepBack = ease((time - PLACEMENT.stepBack) / (PLACEMENT.cameraHome - PLACEMENT.stepBack));
    const moving = Math.sin(enter * Math.PI) + Math.sin(stepBack * Math.PI) * 0.75;
    out.eye.set(
      mix(400, BOARD.centreX, enter),
      5050 + Math.sin(time * 4.4) * 7 * moving,
      mix(8600, mobile ? 6400 : 4200, enter) - lean * 240,
    );
    out.look.set(
      mix(-200, BOARD.centreX, enter) + glance,
      mix(4000, BOARD.centreY - 100, lift) + check * 220,
      BOARD.z,
    );
    const framing = SCENES.kitchen.framing(camera.aspect);
    const finalTarget = v(...framing.target);
    const finalEye = finalTarget.clone().add(v(
      framing.radius * Math.sin(framing.phi) * Math.sin(framing.theta),
      framing.radius * Math.cos(framing.phi),
      framing.radius * Math.sin(framing.phi) * Math.cos(framing.theta),
    ));
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
    camera.fov = mix(mobile ? 78 : 54, SCENES.kitchen.framing(camera.aspect).fov,
      ease((time - PLACEMENT.stepBack) / (PLACEMENT.cameraHome - PLACEMENT.stepBack)));
    home.visible = indoors; street.visible = !indoors;
    scene.background = new THREE.Color(indoors ? SCENES.kitchen.background : 0xb7b9ac);
    scene.environment = indoors ? indoorEnvironment!.texture : outdoorEnvironment.texture;
    scene.environmentIntensity = indoors ? SCENES.kitchen.envIntensity : 0.42;
    renderer.toneMappingExposure = indoors ? SCENES.kitchen.exposure : 0.92;

    bodyAt(time, mobile, now);
    bodyAt(time - 0.16, mobile, before);
    camera.position.copy(now.eye);
    camera.lookAt(now.look);
    // Keep the arm solver on the torso basis. The head moves independently
    // above it, so a footfall does not shake the hands and view as one object.
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    upward.setFromMatrixColumn(camera.matrixWorld, 1);
    ahead.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const head = openingMotion(time, now.moving);
    const settleView = 1 - ease((time - 26) / 1);
    camera.position.addScaledVector(right, head.x * settleView)
      .addScaledVector(upward, head.y * settleView)
      .addScaledVector(ahead, head.z * settleView);
    camera.rotateX(head.pitch * settleView);
    camera.rotateY(head.yaw * settleView);
    camera.rotateZ(head.roll * settleView);

    // Pass linear phase to the rig, which eases each hand separately.
    const reach = THREE.MathUtils.clamp((time - 6.55) / 0.85, 0, 1);
    const release = THREE.MathUtils.clamp((time - PLACEMENT.release) / 2.0, 0, 1);
    const grip = THREE.MathUtils.clamp((time - 7.4) / 1.1, 0, 1);

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
      // Lift, pause to inspect one edge, then tip the other way before
      // carrying on. Unequal beats keep the gesture from reading as a loop.
      const inspect = ease((time - 10.5) / 0.55) * (1 - ease((time - 12.6) / 0.7));
      const turn = ease((time - 11.55) / 0.65);
      board.rotation.x += inspect * mix(0.21, -0.145, turn);
      board.rotation.y += inspect * mix(-0.25, 0.19, turn);
      board.rotation.z += inspect * mix(-0.085, 0.055, turn);
      board.position.y += inspect * 130;
      // The weight dips once as the lift stops, then settles into a slower
      // carrying sway below the quicker motion of the head.
      const load = ease((time - 10.1) / 0.22) * (1 - ease((time - 10.55) / 0.5));
      board.position.y -= load * 70;
      board.rotation.z += Math.sin(time * Math.PI * 1.8 - 0.8) * 0.012 * now.moving * now.stand;
    } else {
      // Raise the board first, pause to sight the top edge, then reach toward
      // the wall. The right side leads slightly before the left levels it.
      const lift = ease((time - PLACEMENT.lift) / 0.95);
      const extend = ease((time - PLACEMENT.inspect) / 0.8);
      const correct = ease((time - PLACEMENT.align) / 0.6);
      const press = ease((time - PLACEMENT.press) / 0.7);
      const lower = ease((time - PLACEMENT.lower) / 0.45);
      const seat = ease((time - PLACEMENT.seat) / 0.65);
      const effort = lift * (1 - press);
      board.position.set(
        mix(carriedBoard.x, BOARD.centreX + 100 * (1 - correct), lift),
        mix(carriedBoard.y, BOARD.centreY + 185, lift) - lower * 185,
        mix(carriedBoard.z, BOARD.z + 430, extend) - press * 170 - seat * 260,
      );
      board.rotation.set(
        mix(-0.2, -0.095, lift) * (1 - press),
        mix(-0.07, 0.027, correct) * effort * (1 - press),
        mix(0.02, -0.055, lift) * (1 - correct),
      );
      // Keep the back corners clear while the board is tilted. Leave room
      // for supporting fingers until they peel away, then seat it flush.
      board.updateMatrix();
      const e = board.matrix.elements;
      const rearExtent = Math.abs(e[2]) * (BOARD.width / 2 + 96)
        + Math.abs(e[6]) * (BOARD.height / 2 + 96) + 50;
      board.position.z = Math.max(board.position.z, rearExtent + 12);
      // Brief pressure tremor dies out before the board is on its mounting.
      const tension = Math.sin(time * 16.1) * 3.6 * effort;
      board.position.y += tension;

    }

    limbs.show(reach > 0 && release < 1);
    if (limbs.arms.visible) {
      limbs.pose({
        board, eye: now.eye, right, up: upward, forward: ahead,
        reach, grip, release, time, moving: now.moving,
      });
    }

    camera.updateProjectionMatrix();
    /*
     * Where the light is coming from, which changes halfway through.
     *
     * Outside it is the sun over the roofline; inside it is the kitchen
     * window, which is the only bright thing in the room and the thing the
     * whole shot is walking toward. Handing the pass a point rather than a
     * direction is what lets it keep working as the body turns: it projects
     * the point each frame and fades the scattering out as it leaves the
     * frame, so the bands swing with the walk instead of sitting still.
     */
    post.setSource(indoors ? indoorScatter : outdoorScatter, indoors ? 0xffe9c6 : 0xfff0d2);
    /*
     * And the grade, which changes at the same moment and for the same
     * reason. Outside is an overcast afternoon in a service alley: flat,
     * grey-green, nothing warm in it anywhere. Inside is the kitchen's own
     * grade, which is the whole of what the walk is towards — the shot is
     * about arriving somewhere warmer than where it started, and the two
     * grades are how that lands before anything else in the frame has had a
     * chance to say so.
     */
    post.setGrade(indoors ? SCENES.kitchen.grade : STREET_GRADE);
    post.render(scene, camera);
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
      outdoorEnvironment.dispose(); indoorEnvironment?.dispose(); pmrem.dispose(); post.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
