import * as THREE from 'three';
import { EYE_BOX, ORBIT_LIMITS, TARGET_BOUNDS } from './layout';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The camera, on a leash.
 *
 * Spherical around a target: drag swings it, wheel pulls it in and out, and a
 * second set of "desired" values is chased by the live ones so every gesture
 * lands softly instead of stopping dead. The limits keep it inside the room
 * and facing the wall — you can lean around a book on the counter, but you
 * cannot end up behind the plaster wondering where the room went.
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
    this.flying = false;
    this.wantTheta = clamp(this.wantTheta - dx * 0.0023, ORBIT_LIMITS.minTheta, ORBIT_LIMITS.maxTheta);
    this.wantPhi = clamp(this.wantPhi - dy * 0.0017, ORBIT_LIMITS.minPhi, ORBIT_LIMITS.maxPhi);
  }

  dolly(factor: number) {
    this.flying = false;
    this.wantRadius = clamp(this.wantRadius / factor, ORBIT_LIMITS.minRadius, ORBIT_LIMITS.maxRadius);
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
    const fitW = size.x / 2 / Math.tan(vFov / 2) / camera.aspect;
    const radius = clamp(
      Math.max(fitH, fitW, size.z) * padding,
      ORBIT_LIMITS.minRadius,
      ORBIT_LIMITS.maxRadius,
    );
    this.wantTarget.copy(centre);
    this.clampTarget();
    this.wantRadius = radius;
    this.flying = true;
  }

  private clampTarget() {
    this.wantTarget.x = clamp(this.wantTarget.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
    this.wantTarget.y = clamp(this.wantTarget.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);
    this.wantTarget.z = clamp(this.wantTarget.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
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
