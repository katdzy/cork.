/** Continuous, timestamp-based head motion: stable when paused or scrubbed. */
export function openingMotion(time: number, walking: number) {
  const gait = Math.max(0, Math.min(1, walking));
  const step = time * Math.PI * 3.6 + Math.sin(time * 0.73) * 0.14;
  const stride = step * 0.5;
  // Brief heel strike followed by a softer recovery, twice per stride.
  const impact = Math.pow(Math.max(0, Math.sin(step)), 8);
  const fine = Math.sin(time * 17.3) * 0.55 + Math.sin(time * 23.9 + 1.2) * 0.3
    + Math.sin(time * 31.1 + 0.7) * 0.15;
  const motion = {
    x: Math.sin(stride) * 48 * gait + Math.sin(time * 0.87) * 5,
    y: (Math.cos(step) * 30 - impact * 24) * gait + Math.sin(time * 1.23) * 7,
    z: Math.sin(step - 0.5) * 18 * gait,
    pitch: (Math.sin(step - 0.35) * 0.0045 + impact * 0.003) * gait + fine * 0.0006,
    yaw: Math.sin(stride - 0.6) * 0.005 * gait + Math.sin(time * 1.37) * 0.0012,
    roll: Math.sin(stride + 0.3) * 0.008 * gait + fine * 0.0008 * gait,
  };
  // The expressive pass doubles the head motion, while the choreography
  // still controls when walking starts, stops, and settles at the end.
  return {
    x: motion.x * 2, y: motion.y * 2, z: motion.z * 2,
    pitch: motion.pitch * 2, yaw: motion.yaw * 2, roll: motion.roll * 2,
  };
}
