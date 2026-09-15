import * as THREE from 'three';
import { BOARD } from './layout';
import { arc } from './parts';
import { fabric } from './textures';

/**
 * The pair of arms carrying the board.
 *
 * What this replaced was two tapered tubes drawn from the rail to a fixed
 * point a metre in front of the camera, welded into the board's own group.
 * Two things gave it away. The far end of each tube was an elbow that
 * stopped, in mid-air, inside the frame — arms do not end, they leave the
 * shot. And nothing about them ever changed: a rigid pair of shapes carried
 * by the board's matrix reads as part of the board, which is the whole of the
 * robot feeling.
 *
 * So the arms are solved here rather than posed. The hands belong to the
 * board, because that is what gripping something means; the shoulders belong
 * to the body, which in a first-person shot is the camera; and the elbow is
 * whatever has to be true between the two, found each frame by the oldest
 * trick in animation — two bones, a chord, and a pole vector to say which way
 * the joint breaks. The body then breathes and walks and the elbows open and
 * close because of it, without a keyframe anywhere saying they should.
 *
 * Bone lengths follow the chord instead of fixing it. The board is held
 * further out than an arm can reach — it has to be, or it would not fit in
 * the shot — and an honest twenty-seven centimetre forearm would simply fail
 * to arrive. Scaling the pair keeps the proportion, the bend and the
 * silhouette, and gives up only a measurement nobody in a moving shot can
 * take.
 */

/** The outer face of the frame, which is what a hand closes around. */
const RAIL = BOARD.width / 2 + 96;
/** Half the thickness of a palm: how far off the rail the wrist rides. */
const PALM = 79;
/** Where the grip lands: below the middle of the rail, the way a lift does. */
const GRIP_Y = -210;
/** And how far forward of the frame, leaving the fingers room behind it. */
const GRIP_Z = 300;

/** Open, and shut around a rail three centimetres thick. */
const OPEN: [number, number, number] = [0.15, 0.3, 0.2];
const SHUT: [number, number, number] = [1.42, 1.5, 0.78];

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (t: number) => { const p = THREE.MathUtils.clamp(t, 0, 1); return p * p * (3 - 2 * p); };

export interface ArmPose {
  board: THREE.Object3D;
  /** The body: where it is, and which way it is facing. */
  eye: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  /** 0 while the hands are still out of shot, 1 once they are on the rails. */
  reach: number;
  /** 0 open, 1 closed. */
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
      position.setXYZ(i, position.getX(i) * (68 - 8 * y), y * 172, position.getZ(i) * (120 - 22 * y));
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
    // Tendons, in skin rather than in shadow: form, not drawing.
    for (let i = 0; i < 3; i++) {
      bone(hand, v(side * 30, 76 - i * 58, -110), v(side * 26, 88 - i * 66, -290), 13, 1, skin);
    }

    const fingers: Joint[][] = [];
    const spread = [112, 38, -36, -112];
    for (let i = 0; i < 4; i++) {
      const head = oval(hand, v(side * 26, spread[i] * 0.94, -318), v(30, 34, 30), skin);
      head.scale.multiplyScalar(i === 3 ? 0.86 : 1);
    }
    const reach = [0.98, 1.06, 1, 0.84];
    const thick = [33, 34, 31, 26];
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
        chain.push({ object: joint, rest: OPEN[j] * (1 + i * 0.05), shut: SHUT[j] * (1 + i * 0.03) });
        parent = joint;
      }
      fingers.push(chain);
    }

    /* The thumb comes across the front of the rail, and is the only part of
       the grip the camera can see once the fingers are round the back. */
    const root = new THREE.Group();
    root.position.set(side * 14, 46, -110);
    hand.add(root);
    bone(root, v(0, 0, 0), v(side * -52, 116, -86), 44, 0.9, skin);
    const tip = new THREE.Group();
    tip.position.set(side * -52, 116, -86);
    root.add(tip);
    bone(tip, v(0, 0, 0), v(side * -80, 60, -34), 35, 0.9, skin);
    const thumbNail = oval(tip, v(side * -52, 40, -8), v(5, 23, 18), nail);
    thumbNail.rotation.z = side * 0.9;
    const thumb: Joint[] = [
      { object: root, rest: -0.3, shut: 0.4 },
      { object: tip, rest: -0.18, shut: 0.46 },
    ];

    /* -- and the arm itself, which lives out in the world -------------- */
    const fore = new THREE.Mesh(sleeveGeometry([
      [0, 0], [92, 0.003], [112, 0.012], [118, 0.028], [100, 0.044],
      [124, 0.08], [148, 0.16], [166, 0.34], [178, 0.62], [186, 1],
    ]), sleeve);
    const upper = new THREE.Mesh(sleeveGeometry([
      [0, 0], [186, 0.004], [206, 0.16], [230, 0.5], [242, 0.86], [232, 1],
    ]), sleeve);
    /* Wrist to cuff: narrow, a little flattened, and swelling into the arm.
       Fixed in length rather than stretched with the bone, because it is the
       one part of the arm whose real size the eye knows. */
    const bare = new THREE.Mesh(sleeveGeometry([
      [0, 0], [66, 0.02], [70, 0.16], [76, 0.42], [86, 0.72], [96, 1],
    ]), skin);
    bare.scale.x = 0.82;
    const hem = new THREE.Mesh(new THREE.TorusGeometry(108, 17, 6, arc(20)), cuff);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(190, arc(14), arc(10)), sleeve);
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
        /* Two hands never do the same thing at the same instant. A tenth of a
           second between them is not something anybody will notice happening,
           and is most of why the pair stops looking like one mechanism. */
        const lead = side > 0 ? 0.12 : 0;
        const shut = ease((grip - lead) / 0.88);
        const gone = ease((release - lead) / 0.88);
        const held = 1 - gone;
        const away = 1 - ease((reach - lead) / 0.88);

        /* The hand: on the rail, or on its way to it — in from below and
           outside, which is where a hand comes from when you crouch to pick
           something up off the ground, and where it goes when it lets go. */
        limb.hand.position.set(
          side * (RAIL + PALM + away * 170 + gone * 520),
          GRIP_Y - away * 760 - gone * 560,
          GRIP_Z + away * 460 + gone * 760,
        );
        /* A wrist is never quite straight, and a loaded one gives a little on
           every step. The last term is far too small to see and is doing its
           work anyway: nothing alive is ever perfectly still. */
        const settle = Math.sin(time * 4.4 - 1) * 0.022 * moving * held
          + Math.sin(time * 1.2 + side * 2) * 0.01 * held;
        const on = 1 - away;
        limb.hand.rotation.set(
          -0.14 * on + settle + Math.sin(time * 1.7 + side) * 0.007,
          side * (0.22 - 0.14 * on + gone * 0.5),
          side * (0.18 * on - settle * 1.8 + gone * 0.42),
        );

        // Fingers shut one after another, index first, the way a hand shuts.
        for (let i = 0; i < 4; i++) {
          const closed = ease((shut - i * 0.06) / 0.8);
          for (const joint of limb.fingers[i]) {
            joint.object.rotation.y = side * THREE.MathUtils.lerp(joint.rest, joint.shut, closed);
          }
        }
        // The thumb comes over last, once the fingers have something for it
        // to press against.
        const pinch = ease((shut - 0.24) / 0.76);
        for (const joint of limb.thumb) {
          joint.object.rotation.z = side * THREE.MathUtils.lerp(joint.rest, joint.shut, pinch);
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
        const strain = Math.sin(time * 7.3 + side * 2.1) * 5 * held * (1 - moving);
        shoulder.copy(eye)
          .addScaledVector(right, side * 900 + strain)
          .addScaledVector(up, -680 + breath + Math.sin(time * 4.4 + (side > 0 ? 0 : Math.PI)) * 24 * moving)
          .addScaledVector(forward, -240 + breath * 0.5);

        chord.subVectors(wrist, shoulder);
        const span = Math.max(1, chord.length());
        axis.copy(chord).divideScalar(span);
        /* An upper arm a little longer than a forearm, and the pair a little
           longer than the gap they cross — which is what leaves a bend in the
           elbow. Two bones that exactly span the distance give a straight
           arm, and a straight arm is a stick. */
        const upperLength = span * 0.617;
        const foreLength = span * 0.551;

        /* Which way the elbow breaks: down and out, swinging a little with
           the walk. Squared to the chord, so a bend stays a bend at whatever
           angle the board is being held. */
        pole.copy(up).multiplyScalar(-1)
          .addScaledVector(right, side * (0.62 + Math.sin(time * 2.2 + side * 1.4) * 0.09 * moving
            + Math.sin(time * 0.9 + side) * 0.02))
          .addScaledVector(forward, -0.14);
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
        aim(limb.bare, wrist, cuffAt.clone().multiplyScalar(340).add(wrist), pole);
        cuffAt.multiplyScalar(296).add(wrist);
        aim(limb.fore, cuffAt, elbowAt, pole);
        aim(limb.upper, elbowAt, shoulder, pole);
        limb.hem.position.copy(cuffAt);
        limb.hem.quaternion.copy(limb.fore.quaternion);
        limb.elbow.position.copy(elbowAt);
      }
    },
  };
}
