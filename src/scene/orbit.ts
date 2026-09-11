import * as THREE from 'three';
import { EYE_BOX, ORBIT_LIMITS, TARGET_BOUNDS } from './layout';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The rectangle the cork view may slide across, and how close it may get.
 *
 * Half-extents rather than corners because what the clamp actually compares
 * them against is half of what the lens takes in, and the arithmetic reads
 * better when both sides of it are the same kind of number.
 */
export interface CorkLeash {
  centreX: number;
  centreY: number;
  z: number;
  halfW: number;
  halfH: number;
  /**
   * How much of the window's width is behind chrome, down the left edge, as a
   * fraction of it.
   *
   * The viewport and the part of it you can see are not the same rectangle —
   * there is a sidebar over one end of it. In the room that only shifts the
   * composition; on a board you are arranging it hides the things you were
   * going to arrange. So the cork view frames, clamps and fits against the
   * visible rectangle rather than the whole window, and this one number is
   * the whole of the difference.
   */
  insetFrac: number;
  minRadius: number;
  maxRadius: number;
}

interface Pose {
  target: THREE.Vector3;
  radius: number;
  theta: number;
  phi: number;
}

/**
 * The camera, on a leash.
 *
 * Spherical around a target: drag swings it, wheel pulls it in and out, and a
 * second set of "desired" values is chased by the live ones so every gesture
 * lands softly instead of stopping dead. The limits keep it inside the room
 * and facing the wall — you can lean around a book on the counter, but you
 * cannot end up behind the plaster wondering where the room went.
 *
 * It also has a second, smaller way of moving, which is what `cork` below is.
 *
 * ## The cork view
 *
 * Arranging a board and looking around a room are opposite jobs, and a camera
 * good at the second is actively bad at the first. Free orbit means every
 * drag carries three of its own axes into a gesture meant for two: reach for a
 * photograph, miss it by four pixels, and the room swings instead — the
 * photograph is now somewhere else on screen, at a slightly different angle,
 * and the drag that was going to move it has to be started again from a view
 * you did not ask for. The board is a flat thing on a wall; while you are
 * working on it the camera should behave like one.
 *
 * So the cork view drops `theta` to zero and `phi` to a right angle and holds
 * them there. The camera sits on the board's own axis, square on, and keeps
 * exactly two degrees of freedom: slide and zoom. Rotation is not restricted
 * to a small range or damped or snapped back — `rotate` returns without doing
 * anything, because an axis that cannot be reached by accident is the only
 * kind that is genuinely safe.
 *
 * Two things follow from being square on. Screen space and board space become
 * the same space up to a scale, so a photograph dragged across the board
 * tracks the pointer exactly rather than sliding along a foreshortened plane.
 * And the frame can be kept full of cork, because the visible rectangle is a
 * rectangle on the board rather than a trapezium across it — which is what
 * `clampTarget` does below.
 */
export class Orbit {
  readonly target = new THREE.Vector3();
  private readonly wantTarget = new THREE.Vector3();
  private theta = 0;
  private phi = Math.PI / 2;
  private radius = 5000;
  private wantTheta = 0;
  private wantPhi = Math.PI / 2;
  private wantRadius = 5000;
  /** Set while a flight is in progress, so input doesn't fight it. */
  private flying = false;
  /** Non-null in the cork view: square on to the board, two axes. */
  private cork: CorkLeash | null = null;
  /** Where the room was left standing, to be put back on the way out. */
  private parked: Pose | null = null;
  /**
   * The lens, as the clamp needs it.
   *
   * Half-extents depend on the field of view and the aspect ratio, which live
   * on the camera — and the camera is only in hand during `update`. Panning
   * happens between frames, so what it reads is last frame's, which is the
   * same as this frame's unless the window was resized mid-drag.
   */
  private lens = { tanHalf: Math.tan((38 * Math.PI) / 360), aspect: 1.6 };

  private readLens(camera: THREE.PerspectiveCamera) {
    this.lens.tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    this.lens.aspect = camera.aspect || 1.6;
  }

  get inCork() {
    return this.cork !== null;
  }

  set(target: THREE.Vector3Like, radius: number, theta: number, phi: number, instant = false) {
    this.wantTarget.set(target.x, target.y, target.z);
    this.wantRadius = radius;
    this.wantTheta = theta;
    this.wantPhi = phi;
    this.flying = !instant;
    if (instant) {
      this.target.copy(this.wantTarget);
      this.radius = radius;
      this.theta = theta;
      this.phi = phi;
      this.flying = false;
    }
  }

  rotate(dx: number, dy: number) {
    // The whole point of the cork view. Not damped, not snapped back: gone.
    if (this.cork) return;
    this.flying = false;
    this.wantTheta = clamp(this.wantTheta - dx * 0.0023, ORBIT_LIMITS.minTheta, ORBIT_LIMITS.maxTheta);
    this.wantPhi = clamp(this.wantPhi - dy * 0.0017, ORBIT_LIMITS.minPhi, ORBIT_LIMITS.maxPhi);
  }

  dolly(factor: number) {
    this.flying = false;
    const [min, max] = this.radiusRange();
    this.wantRadius = clamp(this.wantRadius / factor, min, max);
    // pulling back in the cork view can leave the frame off the board
    this.clampTarget();
  }

  /**
   * Zoom about a point on screen rather than about the middle of it.
   *
   * What a flat editing surface owes you is that the thing under the cursor
   * stays under the cursor. Square on, that is one line: a point on the board
   * holds its place when the target closes on it in the same proportion as the
   * camera does, and the proportion is whatever the radius actually ended up
   * changing by once the limits had their say.
   *
   * The point is solved from the pose being *chased*, not from where the
   * camera has got to — which is why this takes screen coordinates rather than
   * a world point somebody raycast for it. A wheel throws a dozen events
   * before the first one has finished animating; anchoring each to the camera
   * mid-flight measures each against a different frame, and the thing under
   * the cursor walks away from it. Square on there is nothing to raycast for
   * anyway: the board is a plane parallel to the film.
   */
  dollyAt(factor: number, ndcX: number, ndcY: number) {
    if (!this.cork) {
      this.dolly(factor);
      return;
    }
    const halfY = this.wantRadius * this.lens.tanHalf;
    const atX = this.wantTarget.x + ndcX * halfY * this.lens.aspect;
    const atY = this.wantTarget.y + ndcY * halfY;
    const fromR = this.wantRadius;
    const fromX = this.wantTarget.x;
    const fromY = this.wantTarget.y;
    this.dolly(factor);
    const k = this.wantRadius / fromR;
    this.wantTarget.x = atX + (fromX - atX) * k;
    this.wantTarget.y = atY + (fromY - atY) * k;
    this.clampTarget();
  }

  /** Slide the target across the plane the camera is facing. */
  pan(dx: number, dy: number, camera: THREE.PerspectiveCamera, viewportHeight: number) {
    this.flying = false;
    const scale = (2 * this.radius * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    this.wantTarget.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.clampTarget();
  }

  /** Frame a box: the classic "how far back do I need to be" solve. */
  focus(box: THREE.Box3, camera: THREE.PerspectiveCamera, padding = 1.55) {
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const vFov = (camera.fov * Math.PI) / 180;
    const fitH = size.y / 2 / Math.tan(vFov / 2);
    const fitW = size.x / 2 / Math.tan(vFov / 2) / (camera.aspect * this.visibleFrac());
    const [min, max] = this.radiusRange();
    // The radius has to land before the target does: square on, how far the
    // target may stray from the middle of the board is a function of it.
    this.wantRadius = clamp(Math.max(fitH, fitW, size.z) * padding, min, max);
    this.wantTarget.copy(centre);
    // and into the middle of what can be seen of the window, not of the window
    this.wantTarget.x -= this.insetShift(this.wantRadius);
    this.clampTarget();
    this.flying = true;
  }

  /* ------------------------------------------------------------ cork view */

  /**
   * Square on to the board, and park the room until we come back to it.
   *
   * Parking only happens on the way in, so re-framing the cork view — a resize,
   * a swap of room — never overwrites the pose the reader actually left.
   */
  enterCork(leash: CorkLeash, radius: number, camera: THREE.PerspectiveCamera, instant = false) {
    if (!this.cork) {
      this.parked = {
        target: this.wantTarget.clone(),
        radius: this.wantRadius,
        theta: this.wantTheta,
        phi: this.wantPhi,
      };
    }
    this.readLens(camera);
    this.cork = leash;
    const r = clamp(radius, leash.minRadius, leash.maxRadius);
    this.set(
      { x: leash.centreX - this.insetShift(r), y: leash.centreY, z: leash.z },
      r,
      0,
      Math.PI / 2,
      instant,
    );
  }

  /** The same view of a different-shaped window: re-leash, don't re-frame. */
  releash(leash: CorkLeash, camera: THREE.PerspectiveCamera) {
    if (!this.cork) return;
    this.readLens(camera);
    this.cork = leash;
    this.wantRadius = clamp(this.wantRadius, leash.minRadius, leash.maxRadius);
    this.clampTarget();
  }

  /** Change what "back to the room" means — the board moved to another wall. */
  parkAt(target: THREE.Vector3Like, radius: number, theta: number, phi: number) {
    this.parked = {
      target: new THREE.Vector3(target.x, target.y, target.z),
      radius,
      theta,
      phi,
    };
  }

  /** Back to the room, exactly where it was left. False if there is nowhere. */
  exitCork(): boolean {
    const pose = this.parked;
    this.cork = null;
    this.parked = null;
    if (!pose) return false;
    this.set(pose.target, pose.radius, pose.theta, pose.phi);
    return true;
  }

  private radiusRange(): [number, number] {
    return this.cork
      ? [this.cork.minRadius, this.cork.maxRadius]
      : [ORBIT_LIMITS.minRadius, ORBIT_LIMITS.maxRadius];
  }

  /** The share of the window that isn't behind chrome. One, in the room. */
  private visibleFrac() {
    return this.cork ? 1 - this.cork.insetFrac : 1;
  }

  /**
   * How far left of the board the camera stands so the board sits in the
   * middle of what can be seen.
   *
   * Half the hidden strip, in world units — which shrinks as you move in,
   * because a sidebar of a fixed number of pixels covers less of the board
   * the closer you get to it.
   */
  private insetShift(radius: number) {
    return this.cork ? radius * this.lens.tanHalf * this.lens.aspect * this.cork.insetFrac : 0;
  }

  private clampTarget() {
    const cork = this.cork;
    if (!cork) {
      this.wantTarget.x = clamp(this.wantTarget.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
      this.wantTarget.y = clamp(this.wantTarget.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);
      this.wantTarget.z = clamp(this.wantTarget.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
      return;
    }
    /*
     * Keep the frame full of cork.
     *
     * How far the middle of the view may stray from the middle of the board is
     * the board's half-extent less half of what the lens takes in — so the
     * further in you are, the further you may slide, and the moment the board
     * no longer fills the frame on an axis the allowance on that axis goes to
     * nothing and the view centres itself. No rubber band, no dead scroll off
     * the edge into plaster: the limit simply moves with the zoom.
     */
    const halfY = this.wantRadius * this.lens.tanHalf;
    const halfX = halfY * this.lens.aspect * this.visibleFrac();
    const centreX = cork.centreX - this.insetShift(this.wantRadius);
    const rx = Math.max(0, cork.halfW - halfX);
    const ry = Math.max(0, cork.halfH - halfY);
    this.wantTarget.x = clamp(this.wantTarget.x, centreX - rx, centreX + rx);
    this.wantTarget.y = clamp(this.wantTarget.y, cork.centreY - ry, cork.centreY + ry);
    this.wantTarget.z = cork.z;
  }

  get distance() {
    return this.radius;
  }

  /**
   * Chase the desired values and write the camera. Returns true while there is
   * still movement left, which is what keeps the renderer asleep once there
   * isn't — this scene draws on demand, not on a clock.
   */
  update(camera: THREE.PerspectiveCamera, dt: number): boolean {
    this.readLens(camera);

    const k = 1 - Math.exp(-(this.flying ? 7 : 16) * dt);
    const before = this.radius + this.theta * 1000 + this.phi * 1000 + this.target.lengthSq();

    this.theta += (this.wantTheta - this.theta) * k;
    this.phi += (this.wantPhi - this.phi) * k;
    this.radius += (this.wantRadius - this.radius) * k;
    this.target.lerp(this.wantTarget, k);

    const sp = Math.sin(this.phi);
    camera.position.set(
      clamp(this.target.x + this.radius * sp * Math.sin(this.theta), EYE_BOX.minX, EYE_BOX.maxX),
      clamp(this.target.y + this.radius * Math.cos(this.phi), EYE_BOX.minY, EYE_BOX.maxY),
      clamp(this.target.z + this.radius * sp * Math.cos(this.theta), EYE_BOX.minZ, EYE_BOX.maxZ),
    );
    camera.lookAt(this.target);
    camera.updateMatrixWorld();

    const after = this.radius + this.theta * 1000 + this.phi * 1000 + this.target.lengthSq();
    const moving = Math.abs(after - before) > 0.02;
    if (!moving) this.flying = false;
    return moving;
  }
}
