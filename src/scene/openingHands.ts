import * as THREE from 'three';
import { BOARD } from './layout';
import { arc } from './parts';
import { fabric } from './textures';

/** Articulated carrying arms. Hands lock to the rail while loaded; free hands
 * follow a camera-relative path through the lower edge of the frame. The elbow
 * pole stays below and outside the wrist, with a softer bend during reaching. */

/** The outer face of the frame, which is what a hand closes around. */
const RAIL = BOARD.width / 2 + 96;
/** Half the thickness of a palm: how far off the rail the wrist rides. */
const PALM = 92;
/** Where the grip lands: below the middle of the rail, the way a lift does. */
const GRIP_Y = -210;
/** And how far forward of the frame, leaving the fingers room behind it. */
const GRIP_Z = 276;

/** The rail occupies z = -24…64. Keep finger pads behind its back face,
 * with a shallow distal curl rather than a fist that returns into the wood.
 * The opposing thumb is built separately above the front face. */
const OPEN: [number, number, number] = [0.15, 0.3, 0.2];
const SHUT: [number, number, number] = [1.3, 0.35, 0.12];

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (t: number) => { const p = THREE.MathUtils.clamp(t, 0, 1); return p * p * p * (p * (p * 6 - 15) + 10); };

export interface ArmPose {
  board: THREE.Object3D;
  /** The body: where it is, and which way it is facing. */
  eye: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  /** 0 while the hands are still out of shot, 1 once they are on the rails. */
  reach: number;
  /** Pickup phase, 0 approaching contact, 1 carrying. Release is separate. */
  grip: number;
  /** 0 holding, 1 let go and gone. */
  release: number;
  time: number;
  /** How much walking is going on, for the swing and the settle. */
  moving: number;
}

export function buildOpeningHands() {
  /** Board-space, because a hand that is gripping is part of what it holds. */
  const hands = new THREE.Group();
  /** World-space, because an arm is part of the body at the other end. */
  const arms = new THREE.Group();
  hands.visible = arms.visible = false;

  const skin = new THREE.MeshPhysicalMaterial({
    color: 0x9d7b60, roughness: 0.72, sheen: 0.22,
    sheenColor: new THREE.Color(0xe0b193), sheenRoughness: 0.75,
  });
  const nail = new THREE.MeshPhysicalMaterial({ color: 0xc9a794, roughness: 0.44, clearcoat: 0.22 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x5e6b60, roughness: 0.97, ...fabric() });
  const cuff = new THREE.MeshStandardMaterial({ color: 0x4b564d, roughness: 0.99, ...fabric() });

  interface Joint { object: THREE.Group; rest: number; shut: number }
  interface Limb {
    side: number;
    hand: THREE.Group;
    fingers: Joint[][];
    thumb: Joint[];
    bare: THREE.Mesh;
    fore: THREE.Mesh;
    upper: THREE.Mesh;
    hem: THREE.Mesh;
    elbow: THREE.Mesh;
  }
  const limbs: Limb[] = [];

  /**
   * A sleeve, turned on a profile and stretched along the bone.
   *
   * The lathe runs up +Y and is turned to run down -Z, which is the axis
   * `lookAt` aims. Scaling that one axis then lets a single geometry serve
   * any length of arm without changing how thick the arm is.
   */
  function sleeveGeometry(profile: Array<[number, number]>) {
    const geometry = new THREE.LatheGeometry(
      profile.map(([r, along]) => new THREE.Vector2(r, along)),
      arc(18),
    );
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  function oval(parent: THREE.Object3D, at: THREE.Vector3, scale: THREE.Vector3, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, arc(16), arc(12)), material);
    mesh.position.copy(at); mesh.scale.copy(scale);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  /**
   * A bone between two points, as one capsule.
   *
   * It used to be a cone with a sphere stuck on each end, which is fine until
   * two of them meet: every joint became a pair of overlapping balls a shade
   * wider than the segments they joined, and a finger came out as a string of
   * beads. A capsule already ends in the hemisphere the joint wants.
   */
  function bone(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, flat: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, a.distanceTo(b), 3, arc(12)), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
    mesh.scale.x = flat;
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }

  /**
   * The back of a hand: deep and narrow at the wrist, broad and flat across
   * the knuckles. A sphere scaled into a slab reads as a mitten, and the only
   * thing that fixes it is letting the section change along its length.
   */
  function palmGeometry() {
    const geometry = new THREE.SphereGeometry(1, arc(26), arc(18));
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      // +1 is the wrist end, -1 the knuckles: narrow and deep becoming broad
      // and flat, which is the whole difference between a hand and a mitten.
      const y = position.getY(i);
      position.setXYZ(i, position.getX(i) * (82 - 12 * y), y * 162, position.getZ(i) * (128 - 20 * y));
    }
    geometry.computeVertexNormals();
    return geometry;
  }
  const palm = palmGeometry();

  /**
   * One arm, built in the board's own axes: -Z runs from the wrist out to the
   * knuckles, +Y up the rail, and everything across the hand is multiplied by
   * `side` on the way out. That last part is what makes the left one a left
   * one rather than a copy — the thumb opposes the other way and the fingers
   * shut the other way, because they are mirrored rather than turned round.
   */
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hands.add(hand);

    /* The heel of the hand, and nothing beyond it.
       What used to be here was a long stub of bare forearm, drawn in the
       board's axes because the hand is — so it ran straight out toward the
       body while the sleeve behind it ran toward the elbow, and the join
       between them kinked. A wrist bends at the wrist. Everything past this
       ball belongs to the arm and is built with the arm. */
    oval(hand, v(0, -4, 34), v(76, 92, 86), skin);
    const back = new THREE.Mesh(palm, skin);
    back.position.set(side * -2, 10, -156);
    back.rotation.x = Math.PI / 2;
    back.castShadow = back.receiveShadow = true;
    hand.add(back);
    // A soft thumb pad merges the palm into the opposing thumb.
    oval(hand, v(side * -24, 65, -125), v(66, 78, 104), skin);

    const fingers: Joint[][] = [];
    const spread = [112, 38, -36, -112];
    for (let i = 0; i < 4; i++) {
      const head = oval(hand, v(side * 26, spread[i] * 0.94, -318), v(30, 34, 30), skin);
      head.scale.multiplyScalar(i === 3 ? 0.86 : 1);
    }
    const reach = [0.98, 1.06, 1, 0.84];
    const thick = [37, 39, 36, 30];
    for (let i = 0; i < 4; i++) {
      const length = reach[i];
      const radius = thick[i];
      const chain: Joint[] = [];
      const bones: Array<[number, number]> = [
        [128 * length, radius],
        [84 * length, radius * 0.9],
        [58 * length, radius * 0.8],
      ];
      // Proximal, middle, distal, each hung off the end of the last, so that
      // one number shuts the whole finger the way one tendon does.
      let parent: THREE.Object3D = hand;
      for (let j = 0; j < 3; j++) {
        const joint = new THREE.Group();
        joint.position.copy(j === 0 ? v(side * 4, spread[i], -352) : v(0, 0, -bones[j - 1][0]));
        // A little fan, and a little more of it on the outside fingers.
        if (j === 0) joint.rotation.x = (i - 1.6) * 0.045;
        parent.add(joint);
        const [len, r] = bones[j];
        bone(joint, v(0, 0, 0), v(0, 0, -len), r, 0.94, skin);
        if (j === 2) {
          const plate = oval(joint, v(side * r * 0.66, 0, -len * 0.54), v(5, r * 0.42, r * 0.6), nail);
          plate.rotation.z = side * 0.3;
        }
        chain.push({ object: joint, rest: OPEN[j] * (1 + i * 0.05), shut: SHUT[j] });
        parent = joint;
      }
      fingers.push(chain);
    }

    /* The thumb comes across the front of the rail, and is the only part of
       the grip the camera can see once the fingers are round the back. */
    const root = new THREE.Group();
    root.position.set(side * 14, 46, -110);
    hand.add(root);
    bone(root, v(0, 0, 0), v(side * -52, 116, -38), 44, 0.9, skin);
    const tip = new THREE.Group();
    tip.position.set(side * -52, 116, -38);
    root.add(tip);
    bone(tip, v(0, 0, 0), v(side * -80, 60, -12), 35, 0.9, skin);
    const thumbNail = oval(tip, v(side * -52, 40, 12), v(5, 23, 18), nail);
    thumbNail.rotation.z = side * 0.9;
    const thumb: Joint[] = [
      { object: root, rest: -0.3, shut: 0.4 },
      { object: tip, rest: -0.18, shut: 0.46 },
    ];

    /* -- and the arm itself, which lives out in the world -------------- */
    const fore = new THREE.Mesh(sleeveGeometry([
      [0, 0], [126, 0.003], [143, 0.012], [146, 0.028], [134, 0.044],
      [155, 0.08], [190, 0.22], [224, 0.48], [234, 0.72], [218, 1],
    ]), sleeve);
    const upper = new THREE.Mesh(sleeveGeometry([
      [0, 0], [218, 0.004], [248, 0.16], [286, 0.5], [304, 0.86], [292, 1],
    ]), sleeve);
    /* Wrist to cuff: narrow, a little flattened, and swelling into the arm.
       Fixed in length rather than stretched with the bone, because it is the
       one part of the arm whose real size the eye knows. */
    const bare = new THREE.Mesh(sleeveGeometry([
      [0, 0], [78, 0.02], [85, 0.16], [99, 0.42], [117, 0.72], [136, 1],
    ]), skin);
    bare.scale.x = 0.9;
    const hem = new THREE.Mesh(new THREE.TorusGeometry(138, 16, 6, arc(20)), cuff);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(224, arc(14), arc(10)), sleeve);
    for (const piece of [bare, fore, upper, hem, elbow]) {
      piece.castShadow = piece.receiveShadow = true;
      arms.add(piece);
    }

    limbs.push({ side, hand, fingers, thumb, bare, fore, upper, hem, elbow });
  }

  const shoulder = new THREE.Vector3();
  const wrist = new THREE.Vector3();
  const cuffAt = new THREE.Vector3();
  const elbowAt = new THREE.Vector3();
  const chord = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const railAt = new THREE.Vector3();
  const restAt = new THREE.Vector3();
  const handAt = new THREE.Vector3();
  const bareEnd = new THREE.Vector3();

  /** Point a bone at something, rolled so that `up` is up. */
  function aim(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, up: THREE.Vector3) {
    basis.lookAt(from, to, up);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(from);
    mesh.scale.z = from.distanceTo(to);
  }

  return {
    hands,
    arms,
    show(on: boolean) { hands.visible = arms.visible = on; },
    pose({ board, eye, right, up, forward, reach, grip, release, time, moving }: ArmPose) {
      board.updateMatrixWorld();
      for (const limb of limbs) {
        const { side } = limb;
        // The right hand finds the edge first and releases first. The left
        // supports the load for another beat before following it away.
        const dominant = side > 0;
        const lead = dominant ? 0 : 0.3;
        const gone = ease((release - (dominant ? 0.28 : 0.44)) / (dominant ? 0.58 : 0.56));
        const held = 1 - gone;
        const away = 1 - ease((reach - lead) / (dominant ? 0.65 : 0.7));
        const contact = grip - (dominant ? 0 : 0.26);
        const letGo = release - (dominant ? 0 : 0.16);

        // The resting wrist is below the camera frustum, with the shoulder
        // behind it. Visibility changes only at this fully tucked pose.
        restAt.copy(eye).addScaledVector(right, side * 740)
          .addScaledVector(up, -1700).addScaledVector(forward, 180);
        railAt.set(side * (RAIL + PALM), GRIP_Y, GRIP_Z);
        board.localToWorld(railAt);
        const travel = 1 - away;
        handAt.copy(restAt).lerp(railAt, travel);
        handAt.addScaledVector(right, side * Math.sin(travel * Math.PI) * 1100)
          .addScaledVector(up, -Math.sin(travel * Math.PI) * 180);
        // Clear the rail before folding the forearm down toward the body.
        handAt.addScaledVector(right, side * Math.sin(gone * Math.PI) * 1400)
          .addScaledVector(forward, -Math.sin(gone * Math.PI) * 360);
        handAt.lerp(restAt, gone);
        limb.hand.position.copy(board.worldToLocal(handAt));
        // A loaded palm stays fixed against the wood. Let the arm absorb
        // walking motion; rotating the gripping hand pushes fingers through
        // the rail. Only free wrists turn during approach and withdrawal.
        const free = Math.max(away, gone);
        limb.hand.rotation.set(
          -0.12 * free,
          side * (0.22 * away + gone * 0.5),
          side * (0.16 * away + gone * 0.42),
        );

        // Middle and ring fingers take the load, the index adjusts, and the
        // little finger follows. Each joint has its own travel time. On release
        // the fingertips peel away before the knuckles; it is not a reversed
        // whole-hand clench. Free fingers retain a loose, unequal curl.
        const starts = dominant ? [0.09, 0, 0.04, 0.17] : [0.04, 0.02, 0.11, 0.18];
        const durations = [0.43, 0.38, 0.46, 0.39];
        const peel = [0.055, 0.075, 0.025, 0];
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < limb.fingers[i].length; j++) {
            const joint = limb.fingers[i][j];
            const close = ease((contact - starts[i] - j * 0.045) / (durations[i] + j * 0.04));
            const open = ease((letGo - peel[i] - (2 - j) * 0.025) / (0.15 + i * 0.014));
            const loose = joint.rest + [0.08, 0.06, 0.04][j] * (0.65 + i * 0.2);
            // A small, one-off pressure adjustment after contact, strongest
            // in the index finger. Stay within the tested rail-clearance pose.
            const adjust = ease((contact - 0.47 - i * 0.03) / 0.1)
              * (1 - ease((contact - 0.62 - i * 0.025) / 0.12));
            // A light readjustment when inspecting and raising the board:
            // one finger unloads at a time while the other hand supports it.
            const shiftAt = (dominant ? 10.7 : 11.35) + i * 0.13;
            const liftAt = (dominant ? 18.95 : 19.3) + i * 0.09;
            const shift = ease((time - shiftAt) / 0.16) * (1 - ease((time - shiftAt - 0.23) / 0.3))
              + ease((time - liftAt) / 0.13) * (1 - ease((time - liftAt - 0.18) / 0.24));
            const pressure = close * (dominant ? 1 : 0.97)
              * (1 - adjust * (i === 0 ? 0.1 : 0.035)) * (1 - shift * (i === 0 ? 0.085 : 0.025));
            joint.object.rotation.y = side * THREE.MathUtils.lerp(loose, joint.shut, pressure * (1 - open));
          }
        }
        // Opposition starts while the fingers are still finding the rail.
        // The thumb base rolls in first; the tip settles later and unloads
        // first. Neither thumb snaps into the same pose on the same frame.
        for (let j = 0; j < limb.thumb.length; j++) {
          const joint = limb.thumb[j];
          const oppose = ease((contact - (j === 0 ? -0.04 : 0.14)) / (j === 0 ? 0.57 : 0.51));
          const unweight = ease((letGo - (j === 0 ? 0.025 : 0)) / (j === 0 ? 0.2 : 0.15));
          const pressure = oppose * (dominant ? 1 : 0.93) * (1 - unweight);
          joint.object.rotation.z = side * THREE.MathUtils.lerp(joint.rest, joint.shut, pressure);
        }

        /* The arm: the wrist comes from the board, the shoulder from the
           body, and the elbow is what is left over. */
        limb.hand.updateMatrixWorld();
        wrist.setFromMatrixPosition(limb.hand.matrixWorld);
        /* A body that is standing still is not still: it breathes, and it
           trembles a little under something held out in front of it. Both are
           far too small to read as motion and are what stops a held pose
           looking like a photograph with arms drawn on it. */
        const breath = Math.sin(time * 1.15 + side * 0.4) * 14;
        const strain = (Math.sin(time * 13.7 + side * 2.1) * 8
          + Math.sin(time * 19.3 + side * 0.7) * 5) * held;
        const stride = time * Math.PI * 1.8 + (dominant ? 0.2 : 2.7);
        const swing = Math.sin(stride) * moving;
        shoulder.copy(eye)
          .addScaledVector(right, side * (dominant ? 760 : 805) + strain + swing * 38)
          .addScaledVector(up, -820 + (dominant ? 24 : -18) + breath + swing * 54)
          .addScaledVector(forward, -440 + breath * 0.5 + Math.sin(stride - 0.5) * 22 * moving);

        chord.subVectors(wrist, shoulder);
        const span = Math.max(1, chord.length());
        axis.copy(chord).divideScalar(span);
        /* An upper arm a little longer than a forearm, and the pair a little
           longer than the gap they cross — which is what leaves a bend in the
           elbow. Two bones that exactly span the distance give a straight
           arm, and a straight arm is a stick. */
        const extension = travel * (1 - gone);
        const upperLength = span * THREE.MathUtils.lerp(0.76, 0.65, extension);
        const foreLength = span * THREE.MathUtils.lerp(0.68, 0.59, extension);
        // Preserve a substantial silhouette at the cinematic carrying distance.
        const fullness = THREE.MathUtils.clamp(Math.sqrt(span / 2400), 1, 1.48);
        limb.fore.scale.x = limb.fore.scale.y = fullness;
        limb.upper.scale.x = limb.upper.scale.y = fullness;
        limb.elbow.scale.set(fullness, fullness * 1.08, fullness);
        limb.hem.scale.setScalar(fullness);
        limb.bare.scale.x = 0.9 * fullness;
        limb.bare.scale.y = fullness;

        /* Which way the elbow breaks: down and out, swinging a little with
           the walk. Squared to the chord, so a bend stays a bend at whatever
           angle the board is being held. */
        pole.copy(up).multiplyScalar(-1)
          .addScaledVector(right, side * ((dominant ? 0.48 : 0.65) + swing * 0.17
            + Math.sin(time * 0.9 + side) * 0.035 + strain * 0.0015))
          .addScaledVector(forward, -0.2 + Math.sin(stride - 0.3) * 0.035 * moving);
        pole.addScaledVector(axis, -pole.dot(axis)).normalize();

        // Cosine rule: how far down the chord the elbow sits, and how far off.
        const along = THREE.MathUtils.clamp(
          (span * span + upperLength * upperLength - foreLength * foreLength) / (2 * span),
          0, upperLength,
        );
        const off = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
        elbowAt.copy(shoulder).addScaledVector(axis, along).addScaledVector(pole, off);

        // Bare to the cuff, cuff to the elbow.
        cuffAt.copy(elbowAt).sub(wrist).normalize();
        const bareLength = Math.min(480, wrist.distanceTo(elbowAt) * 0.32);
        bareEnd.copy(wrist).addScaledVector(cuffAt, bareLength + 35);
        aim(limb.bare, wrist, bareEnd, pole);
        // Pronation rolls the flattened forearm inward without rotating the
        // contact palm or disturbing the fingers on the rail.
        limb.bare.rotateZ(side * (0.25 + swing * 0.055));
        cuffAt.multiplyScalar(bareLength).add(wrist);
        aim(limb.fore, cuffAt, elbowAt, pole);
        aim(limb.upper, elbowAt, shoulder, pole);
        limb.hem.position.copy(cuffAt);
        limb.hem.quaternion.copy(limb.fore.quaternion);
        limb.elbow.position.copy(elbowAt);
        limb.elbow.quaternion.copy(limb.fore.quaternion);
      }
    },
  };
}
