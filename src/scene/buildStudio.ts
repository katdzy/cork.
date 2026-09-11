import * as THREE from 'three';
import { COUNTER, ROOM } from './layout';
import { arc, bloom, box, cylinder, foliage, lightCone, lightPool, panel, pierced, shaft, still } from './parts';
import { brushed, concrete, cork, fabric, oak, smears, weave } from './textures';
import { quality } from './quality';

/**
 * The studio: a concrete workspace some way up an office building.
 *
 * Board-formed concrete, a floating walnut desk with drawers, a thin ledge
 * under the board, a grey chair, a palm in the corner — and now the two things
 * that make it a floor of a building rather than a basement: a glazed curtain
 * wall down the right-hand side with a city under it, and a doorway on the
 * left onto the rest of the office.
 *
 * The glazing is the key light. The pendants stay lit and keep their bloom,
 * because an office at this hour has both, but they are accents over daylight
 * now rather than the only thing holding the room out of the dark. The mullions
 * are real geometry and cast real shadows, which is most of what sells the
 * window: bars of light laid across the floor and the desk.
 */

/** Where the board hangs in this room — centred, with the desk under it. */
export const STUDIO_BOARD = { centreX: -260, centreY: 4720, z: 62 } as const;

const LAMP_Y = 6260;
const LAMP_Z = 1080;
const LAMP_X = [STUDIO_BOARD.centreX - 1820, STUDIO_BOARD.centreX + 1820];

const LEDGE = { top: 3290, thickness: 62, depth: 420 };

/** The curtain wall: a low spandrel, then glass all the way to the head. */
const GLAZING = {
  sill: 330,
  head: 7150,
  near: 240,
  far: ROOM.depth - 520,
  /** Centres of the vertical mullions are spaced by this. */
  bay: 2180,
  transom: 3980,
} as const;

/**
 * The way out, and the floor beyond it.
 *
 * Kept near the back corner rather than out in the middle of the wall, because
 * a wall seen almost edge-on pushes everything along it toward the edge of the
 * frame — the nearer the opening is to the corner, the further inboard it
 * lands and the more of it you can actually see.
 */
const DOOR = { near: 700, far: 2700, head: 4900 } as const;
const CORRIDOR = { depth: 3400 } as const;

/**
 * The desk stops short of the left wall, which is the whole point of the
 * doorway being there: a worktop run into a doorway is a worktop across a
 * doorway, and the lower half of the opening disappears behind it.
 */
export const STUDIO_DESK = { left: -2900, right: ROOM.halfWidth } as const;

/**
 * The city, from some way up.
 *
 * Drawn rather than photographed, like everything else here: no network, no
 * licences, and it can be tuned to the room's palette instead of the other way
 * round. Distance is carried entirely by haze — each row of towers is mixed
 * further toward the sky colour than the one behind it, which is what depth
 * actually looks like through a few kilometres of air.
 */
function cityTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  const horizon = 604;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#9dc2e6');
  sky.addColorStop(0.52, '#cfe0ee');
  sky.addColorStop(0.86, '#f0eade');
  sky.addColorStop(1, '#fbf3e4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, horizon);

  // the sun, low and off to one side, blown out the way a window blows out
  const sun = ctx.createRadialGradient(760, 300, 0, 760, 300, 420);
  sun.addColorStop(0, 'rgba(255,252,240,0.95)');
  sun.addColorStop(0.35, 'rgba(255,246,222,0.45)');
  sun.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 1024, horizon);

  const ground = ctx.createLinearGradient(0, horizon, 0, 1024);
  ground.addColorStop(0, '#c8cfd6');
  ground.addColorStop(1, '#8d94a0');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, 1024, 1024 - horizon);

  // four ranks of towers, each nearer and less washed out than the last
  const ranks: Array<[number, number, number, string]> = [
    [0.82, 150, 74, '#b9c6d4'],
    [0.62, 232, 96, '#94a4b6'],
    [0.4, 320, 128, '#6f8095'],
    [0.18, 430, 168, '#4e5d72'],
  ];
  let seed = 20260910;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  for (const [, maxH, maxW, colour] of ranks) {
    let x = -80;
    while (x < 1080) {
      const w = 46 + rnd() * maxW;
      const h = 44 + rnd() * maxH;
      ctx.fillStyle = colour;
      ctx.fillRect(x, horizon - h, w, h + 40);
      // lit windows, sparse and only on the nearer ranks
      if (maxH > 220) {
        ctx.fillStyle = 'rgba(255,240,206,0.5)';
        for (let wy = horizon - h + 14; wy < horizon - 12; wy += 15) {
          for (let wx = x + 8; wx < x + w - 10; wx += 13) {
            if (rnd() > 0.72) ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
      x += w + 6 + rnd() * 26;
    }
  }

  // haze, laid over everything, thickest at the horizon
  const haze = ctx.createLinearGradient(0, horizon - 380, 0, 1024);
  haze.addColorStop(0, 'rgba(244,240,230,0.62)');
  haze.addColorStop(0.42, 'rgba(238,236,230,0.18)');
  haze.addColorStop(1, 'rgba(226,228,232,0.05)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - 380, 1024, 1024 - horizon + 380);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** What is through the door: another floor of desks, lit by its own ceiling. */
function officeBeyondTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8e908f';
  ctx.fillRect(0, 0, 512, 512);
  // a glazed partition, and the open plan behind it
  ctx.fillStyle = '#a8adb0';
  ctx.fillRect(0, 300, 512, 212);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(40, 96, 432, 196);
  ctx.strokeStyle = '#3f4244';
  ctx.lineWidth = 7;
  ctx.strokeRect(40, 96, 432, 196);
  for (let x = 40; x <= 472; x += 108) {
    ctx.beginPath();
    ctx.moveTo(x, 96);
    ctx.lineTo(x, 292);
    ctx.stroke();
  }
  // desks and monitors, as silhouettes
  ctx.fillStyle = '#6d6f70';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(70 + i * 140, 232, 112, 12);
    ctx.fillRect(96 + i * 140, 196, 58, 34);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildStudio(): THREE.Group {
  const g = new THREE.Group();
  const W = ROOM.halfWidth * 2;
  const H = ROOM.height;
  const D = ROOM.depth;

  /* -- materials -------------------------------------------------------- */
  const conc = new THREE.MeshStandardMaterial({
    color: 0x6f6f6e,
    roughness: 0.96,
    metalness: 0,
    ...concrete(),
    normalScale: new THREE.Vector2(0.7, 0.7),
    // sealed concrete is matt but not dead: it picks up the glazing faintly
    envMapIntensity: 0.9,
  });
  const walnut = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.44,
    envMapIntensity: 1.4,
    ...oak('walnut', { light: '#a2703f', dark: '#3a2110', repeat: [3, 1], bump: 1.5, seed: 4242 }),
  });
  const floorWood = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.52,
    /* A hard floor under a wall of glass is mostly a picture of that glass.
       Turning the reflection up past one is not physical, and is exactly what
       a single-probe capture needs to read as a reflection at all — spread
       over the whole floor it lands as the long bright smear the window
       actually leaves, which is the thing being imitated. */
    envMapIntensity: 1.8,
    ...oak('darkfloor', { light: '#7d5230', dark: '#2a170c', repeat: 5, bump: 2.4, seed: 1717 }),
  });
  const ink = new THREE.MeshStandardMaterial({
    color: 0x1a1918,
    roughness: 0.44,
    metalness: 0.28,
    envMapIntensity: 1.6,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x24231f,
    roughness: 0.36,
    metalness: 0.7,
    envMapIntensity: 1.9,
    ...brushed(),
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  // Upholstery in a dark room. The first pass used the grey it *is* in
  // daylight, which put the brightest thing in the frame in the foreground,
  // below the board, doing nothing.
  const grey = new THREE.MeshStandardMaterial({
    color: 0x4a4744,
    roughness: 0.96,
    ...fabric(),
    normalScale: new THREE.Vector2(0.55, 0.55),
  });

  /* -- shell ------------------------------------------------------------ */
  const back = panel(W, H, conc);
  back.position.set(0, H / 2, 0);
  g.add(still(back));

  /*
   * Both side walls have holes in them, and the two rotations are mirror
   * images, so the hole's local x is +z on one side and −z on the other. Get
   * that sign wrong and the opening appears at the far end of the wall from
   * where it was asked for, with no error to say so.
   */
  const rightHole = new THREE.Box2(
    new THREE.Vector2(GLAZING.near - D / 2, GLAZING.sill - H / 2),
    new THREE.Vector2(GLAZING.far - D / 2, GLAZING.head - H / 2),
  );
  const right = new THREE.Mesh(pierced(D, H, rightHole), conc);
  right.rotation.y = -Math.PI / 2;
  right.position.set(ROOM.halfWidth, H / 2, D / 2);
  right.receiveShadow = true;
  g.add(still(right));

  const leftHole = new THREE.Box2(
    new THREE.Vector2(D / 2 - DOOR.far, 6 - H / 2),
    new THREE.Vector2(D / 2 - DOOR.near, DOOR.head - H / 2),
  );
  const left = new THREE.Mesh(pierced(D, H, leftHole), conc);
  left.rotation.y = Math.PI / 2;
  left.position.set(-ROOM.halfWidth, H / 2, D / 2);
  left.receiveShadow = true;
  g.add(still(left));

  /* -- the curtain wall ------------------------------------------------- */
  const gx = ROOM.halfWidth;
  const glazeH = GLAZING.head - GLAZING.sill;
  const glazeD = GLAZING.far - GLAZING.near;
  const glazeZ = (GLAZING.near + GLAZING.far) / 2;
  const glazeY = (GLAZING.sill + GLAZING.head) / 2;

  // the view out, hung well outside the glass so it never clips the frame
  const view = new THREE.Mesh(
    new THREE.PlaneGeometry(glazeD * 2.4, glazeH * 2.1),
    new THREE.MeshBasicMaterial({ map: cityTexture(), toneMapped: false }),
  );
  view.rotation.y = -Math.PI / 2;
  view.position.set(gx + 2600, glazeY + 900, glazeZ);
  g.add(still(view));

  /*
   * The glass, in two layers, because one cannot be both.
   *
   * A transparent material in three.js scales everything it produces by its
   * opacity — the reflection included. So a pane faint enough to see the city
   * through is a pane with no reflection in it, and a pane that reflects the
   * room is a wall. The honest fix is `transmission`, which renders the whole
   * scene to a second buffer so the glass can refract it: one more full pass,
   * every frame, for a window.
   *
   * Two draws do it instead. A nearly clear tint for the body of the pane, and
   * over it a black, fully metallic sheet blended additively — black diffuse
   * plus full metalness leaves nothing but the environment term, so what it
   * adds is the reflection and only the reflection. The smear map breaks that
   * reflection up the way a year of weather does, which is also what keeps a
   * single captured probe from being caught out.
   */
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(glazeD, glazeH),
    new THREE.MeshStandardMaterial({
      color: 0xbdd3dd,
      roughness: 0.06,
      metalness: 0.1,
      transparent: true,
      opacity: 0.1,
      // a sheet of glass has no business occluding what is behind it
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(gx - 24, glazeY, glazeZ);
  g.add(still(glass));

  const sheen = new THREE.Mesh(
    new THREE.PlaneGeometry(glazeD, glazeH),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      metalness: 1,
      roughness: 0.08,
      envMapIntensity: 1.1,
      ...smears(),
      normalScale: new THREE.Vector2(0.25, 0.25),
      transparent: true,
      // added on top of a view that is already the brightest thing in the
      // room, so it takes very little to turn a window into a white rectangle
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  sheen.rotation.y = -Math.PI / 2;
  sheen.position.set(gx - 30, glazeY, glazeZ);
  sheen.renderOrder = 6;
  g.add(still(sheen));

  // Frame. These cast, and the bars of shadow they lay across the floor and
  // the desk are most of what makes the window read as a window.
  g.add(still(box(210, 150, glazeD + 40, steel, gx - 105, GLAZING.sill + 60, glazeZ)));
  g.add(still(box(210, 130, glazeD + 40, steel, gx - 105, GLAZING.head - 65, glazeZ)));
  g.add(still(box(190, glazeH, 130, steel, gx - 95, glazeY, GLAZING.near + 65)));
  g.add(still(box(190, glazeH, 130, steel, gx - 95, glazeY, GLAZING.far - 65)));
  g.add(still(box(170, 110, glazeD, steel, gx - 85, GLAZING.transom, glazeZ)));
  for (let z = GLAZING.near + GLAZING.bay; z < GLAZING.far - 200; z += GLAZING.bay) {
    g.add(still(box(180, glazeH, 120, steel, gx - 90, glazeY, z)));
  }

  /* -- the way out, and the floor beyond it ----------------------------- */
  const dx = -ROOM.halfWidth;
  const doorD = DOOR.far - DOOR.near;
  const doorZ = (DOOR.near + DOOR.far) / 2;

  // lining, so the opening has a thickness you can see
  g.add(still(box(200, DOOR.head, 120, steel, dx + 100, DOOR.head / 2, DOOR.near + 60)));
  g.add(still(box(200, DOOR.head, 120, steel, dx + 100, DOOR.head / 2, DOOR.far - 60)));
  g.add(still(box(200, 130, doorD, steel, dx + 100, DOOR.head - 65, doorZ)));

  const beyondMat = new THREE.MeshStandardMaterial({
    map: officeBeyondTexture(),
    roughness: 0.9,
    color: 0xd8dde2,
  });
  const far = panel(doorD + 4200, DOOR.head + 1600, beyondMat);
  far.rotation.y = Math.PI / 2;
  far.position.set(dx - CORRIDOR.depth, (DOOR.head + 1600) / 2, doorZ);
  g.add(still(far));

  const corridorFloor = panel(
    CORRIDOR.depth,
    doorD + 4200,
    new THREE.MeshStandardMaterial({ color: 0x4b4a48, roughness: 0.72 }),
  );
  corridorFloor.rotation.x = -Math.PI / 2;
  corridorFloor.rotation.z = Math.PI / 2;
  corridorFloor.position.set(dx - CORRIDOR.depth / 2, 4, doorZ);
  corridorFloor.receiveShadow = true;
  g.add(still(corridorFloor));

  g.add(still(box(CORRIDOR.depth, 60, doorD + 4200, new THREE.MeshStandardMaterial({ color: 0x33322f, roughness: 1 }),
    dx - CORRIDOR.depth / 2, DOOR.head + 1560, doorZ)));
  // a run of ceiling light, which is what actually spills through the opening
  g.add(still(new THREE.Mesh(
    new THREE.BoxGeometry(CORRIDOR.depth - 500, 46, 420),
    new THREE.MeshBasicMaterial({ color: 0xf6f9ff, toneMapped: false }),
  ).translateX(dx - CORRIDOR.depth / 2).translateY(DOOR.head + 1490).translateZ(doorZ)));
  const corridorWall = new THREE.MeshStandardMaterial({ color: 0x6a6b69, roughness: 0.9 });
  for (const side of [-1, 1]) {
    g.add(still(box(CORRIDOR.depth, DOOR.head + 1600, 60, corridorWall,
      dx - CORRIDOR.depth / 2, (DOOR.head + 1600) / 2, doorZ + side * ((doorD + 4200) / 2))));
  }

  // Two, not one: the far one lifts the office beyond off black, the near one
  // stands in the opening so the doorway itself reads as a source of light
  // rather than as a grey rectangle painted on the wall.
  const corridorLight = new THREE.PointLight(0xe6eeff, 2.9e7, 0, 2);
  corridorLight.position.set(dx - 1500, DOOR.head + 500, doorZ);
  g.add(corridorLight);
  const doorGlow = new THREE.PointLight(0xdde8ff, 9e6, 0, 2);
  doorGlow.position.set(dx - 320, DOOR.head - 900, doorZ);
  g.add(doorGlow);

  const floor = panel(W, D, floorWood);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, D / 2);
  g.add(still(floor));

  const ceil = panel(W, D, new THREE.MeshStandardMaterial({ color: 0x2b2a29, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, D / 2);
  g.add(still(ceil));

  /* -- the board's frame: a thin dark bezel, not a moulding ------------- */
  const f = 46;
  const bw = 3600 + f * 2;
  const bh = 2400 + f * 2;
  const cx = STUDIO_BOARD.centreX;
  const cy = STUDIO_BOARD.centreY;
  for (const [w, h, ox, oy] of [
    [bw, f, 0, bh / 2 - f / 2],
    [bw, f, 0, -bh / 2 + f / 2],
    [f, bh - f * 2, -bw / 2 + f / 2, 0],
    [f, bh - f * 2, bw / 2 - f / 2, 0],
  ]) {
    g.add(still(box(w, h, 96, ink, cx + ox, cy + oy, STUDIO_BOARD.z + 24)));
  }
  g.add(still(box(3600, 2400, 44, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    ...cork(),
    normalScale: new THREE.Vector2(0.85, 0.85),
  }), cx, cy, STUDIO_BOARD.z - 28)));

  /* -- pendants --------------------------------------------------------- */
  /* Hoisted out of the loop, like every other material here. Two identical
     materials that are not the *same* material are two draw calls the merge
     cannot fold, because what it batches by is material identity. */
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x121110,
    roughness: 0.4,
    metalness: 0.35,
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
  });
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  const lights: THREE.SpotLight[] = [];
  for (const lx of LAMP_X) {
    // cord, from the ceiling
    const cord = cylinder(7, 7, H - LAMP_Y - 150, ink, 6);
    cord.position.set(lx, (H + LAMP_Y + 150) / 2, LAMP_Z);
    g.add(still(cord));
    g.add(still(box(120, 26, 120, ink, lx, H - 13, LAMP_Z)));

    // the shade: a dome, open underneath, tipped a little toward the board
    const shade = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, arc(22), arc(12), 0, Math.PI * 2, 0, Math.PI * 0.52),
      shadeMat,
    );
    dome.castShadow = true;
    shade.add(dome);
    // the hot mouth, which is what the eye reads as "switched on"
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(268, arc(24)), mouthMat);
    mouth.rotation.x = Math.PI / 2;
    mouth.position.y = -12;
    shade.add(mouth);
    shade.position.set(lx, LAMP_Y, LAMP_Z);
    shade.rotation.x = -0.22;
    g.add(shade);

    // fake bloom, and the shaft of light under the shade
    const glow = bloom(0xffbc72, 1500, 4200, 1);
    glow.position.set(lx, LAMP_Y - 40, LAMP_Z);
    g.add(glow);

    const cone = lightCone(0xffb469, 300, 1180, 2200, 0.85);
    cone.position.set(lx, LAMP_Y - 1120, LAMP_Z - 170);
    cone.rotation.x = 0.15;
    g.add(cone);

    /**
     * Spot rather than point: a point light needs a six-face cube shadow map
     * and this one only ever shines down a cone. Intensity looks absurd
     * because three.js is physically correct and the room is measured in
     * board units — with inverse-square falloff over three thousand of them
     * to the metre, candelas get large.
     */
    const spot = new THREE.SpotLight(0xffc98d, 1.5e7, 0, 0.62, 0.75, 2);
    spot.position.set(lx, LAMP_Y - 60, LAMP_Z);
    spot.target.position.set(lx, cy - 300, 0);
    /* Each pendant is a second shadow pass over the whole room. Daylight is
       the key here and draws the shadows that matter; on a machine that has
       to choose, these are what it gives up. */
    spot.castShadow = quality().spotShadows;
    spot.shadow.mapSize.setScalar(quality().spotShadow || 512);
    spot.shadow.bias = -0.0008;
    spot.shadow.normalBias = 30;
    spot.shadow.camera.near = 200;
    spot.shadow.camera.far = 14000;
    spot.shadow.camera.updateProjectionMatrix();
    g.add(spot, spot.target);
    lights.push(spot);
  }

  /* -- the ledge under the board ---------------------------------------- */
  const ledgeW = bw + 900;
  g.add(still(box(ledgeW, LEDGE.thickness, LEDGE.depth, ink, cx, LEDGE.top - LEDGE.thickness / 2, LEDGE.depth / 2)));
  for (const bx of [cx - ledgeW / 2 + 260, cx + ledgeW / 2 - 260]) {
    g.add(still(box(40, 210, 40, ink, bx, LEDGE.top - 170, LEDGE.depth - 60)));
  }

  // books lying and leaning on it
  const cloth = [0x2f2a26, 0x3d3630, 0x27302c, 0x4a3d31, 0x232323].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.86 }),
  );
  let px = cx - 1500;
  for (let i = 0; i < 7; i++) {
    const w = 52 + ((i * 37) % 40);
    const h = 300 + ((i * 53) % 150);
    const b = box(w, h, 300, cloth[i % 5], px + w / 2, LEDGE.top + h / 2, 210);
    if (i === 6) b.rotation.z = 0.2;
    g.add(still(b));
    px += w + 6;
  }

  // a small task lamp, arm folded over the ledge
  const armBase = cylinder(90, 110, 40, steel, 16);
  armBase.position.set(cx - 2100, LEDGE.top + 20, 220);
  g.add(still(armBase));
  const arm = cylinder(16, 16, 620, steel, 8);
  arm.position.set(cx - 2100, LEDGE.top + 300, 220);
  arm.rotation.z = 0.24;
  g.add(still(arm));
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(150, arc(16), arc(10), 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x16150f, roughness: 0.42, metalness: 0.4, side: THREE.DoubleSide }),
  );
  head.position.set(cx - 2240, LEDGE.top + 590, 300);
  head.rotation.set(2.5, 0, 0.5);
  head.castShadow = true;
  g.add(still(head));

  // a pothos trailing off the far end
  const potA = cylinder(160, 130, 240, new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.72 }));
  potA.position.set(cx + 1900, LEDGE.top + 120, 220);
  g.add(still(potA));
  const trailing = foliage(7, 460, 620, 320);
  trailing.position.set(cx + 1900, LEDGE.top + 230, 220);
  g.add(trailing);

  /* -- the floating desk ------------------------------------------------ */
  const deskW = STUDIO_DESK.right - STUDIO_DESK.left;
  const deskCX = (STUDIO_DESK.left + STUDIO_DESK.right) / 2;
  g.add(still(box(deskW, COUNTER.thickness, COUNTER.depth, walnut,
    deskCX, COUNTER.top - COUNTER.thickness / 2, COUNTER.depth / 2)));
  // the end panel it stops on
  g.add(still(box(90, COUNTER.top - 260, COUNTER.depth - 120, walnut,
    STUDIO_DESK.left + 45, (COUNTER.top - 260) / 2 + 130, (COUNTER.depth - 120) / 2)));

  // two drawers slung under it, and the shadow they sit in
  const drawerH = 380;
  const drawerY = COUNTER.top - COUNTER.thickness - drawerH / 2;
  for (const dx of [cx - 1180, cx + 1180]) {
    g.add(still(box(2180, drawerH, COUNTER.depth - 260, walnut, dx, drawerY, (COUNTER.depth - 260) / 2)));
    g.add(still(box(2180, 12, 26, ink, dx, drawerY + drawerH / 2 - 40, COUNTER.depth - 250)));
    g.add(still(box(340, 26, 40, steel, dx, drawerY, COUNTER.depth - 244)));
  }

  /* -- the chair -------------------------------------------------------- */
  const chair = new THREE.Group();
  chair.add(box(1180, 130, 1120, grey, 0, 1180, 0));
  const back2 = box(1150, 940, 140, grey, 0, 1690, -520);
  back2.rotation.x = -0.21;
  chair.add(back2);
  chair.add(box(120, 700, 140, steel, 0, 1560, -560));
  for (const [lx, lz] of [[-520, -480], [520, -480], [-520, 480], [520, 480]]) {
    const leg = box(56, 1180, 56, steel, lx, 590, lz);
    leg.rotation.set(lz > 0 ? -0.05 : 0.05, 0, lx > 0 ? 0.05 : -0.05);
    chair.add(leg);
  }
  chair.add(box(1180, 46, 56, steel, 0, 680, 480));
  chair.add(box(1180, 46, 56, steel, 0, 680, -480));
  chair.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  // pushed out to the corner: in the reference the chair is a foreground crop,
  // not a grey slab parked in the middle of the composition under the board
  chair.position.set(cx + 1780, 0, 3900);
  chair.rotation.y = 0.28;
  g.add(chair);

  /* -- the corner ------------------------------------------------------- */
  const palmPot = cylinder(430, 340, 760, new THREE.MeshStandardMaterial({ color: 0x39332d, roughness: 0.9 }));
  palmPot.position.set(-3300, 380, 1500);
  g.add(still(palmPot));
  const palm = foliage(11, 1500, 2300, 260);
  palm.position.set(-3300, 760, 1500);
  g.add(palm);

  const basket = cylinder(420, 340, 720, new THREE.MeshStandardMaterial({
    ...weave(), roughness: 0.96, side: THREE.DoubleSide,
  }), 22, true);
  basket.position.set(-3820, 360, 3100);
  g.add(still(basket));

  /* -- daylight, which is now the key ----------------------------------- */
  const sun = new THREE.DirectionalLight(0xfff1dd, 4.1);
  sun.position.set(gx + 9000, 8600, glazeZ + 2600);
  sun.target.position.set(-600, 2500, 2200);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(quality().sunShadow);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 30;
  sun.shadow.radius = 2;
  const sc = sun.shadow.camera;
  sc.left = -8200;
  sc.right = 8200;
  sc.top = 7200;
  sc.bottom = -5600;
  sc.near = 2000;
  sc.far = 30000;
  sc.updateProjectionMatrix();
  g.add(sun, sun.target);

  /*
   * Bars of late air, one per bay of the curtain wall.
   *
   * The mullions are real geometry and already lay real shadows across the
   * floor; what is missing is the light between the window and that floor.
   * The gaps come free — a shaft is placed at the centre of each bay and
   * nowhere else, so the dark stripes between them are the mullions, at the
   * spacing the mullions actually have.
   */
  if (quality().shafts) {
    const towards = new THREE.Vector3().copy(sun.target.position).sub(sun.position).normalize();
    /* Short, so they die out in the open span beside the desk rather than
       reaching the board and laying a straight-edged stripe across the cork —
       a card cut off by the depth test looks exactly like a card. */
    for (let z = GLAZING.near + GLAZING.bay / 2; z < GLAZING.far - 600; z += GLAZING.bay) {
      g.add(shaft({ x: gx - 300, y: GLAZING.transom + 900, z }, towards, 3000, 1050, 0xffd9a8, 0.3));
    }
    // and the warm patch it leaves on the boards inside the glazing
    g.add(lightPool({ x: gx - 1500, y: 8, z: glazeZ - 700 }, 3800, 6400, 0xffc98d, 0.34));
  }

  /*
   * And the rest.
   *
   * The room used to fall away into the dark because there was nothing else in
   * it; with a wall of glass down one side it falls away into shade instead,
   * which is a different and much more legible thing. The pendants are still
   * on — an office at this hour has both — but they are accents over daylight
   * now rather than the only thing holding the room out of black.
   */
  g.add(new THREE.HemisphereLight(0x9ab4d0, 0x4a3a2c, 0.44));
  const spill = new THREE.PointLight(0xffd3a4, 4.4e6, 0, 1.9);
  spill.position.set(STUDIO_BOARD.centreX, 3600, 3200);
  g.add(spill);
  return g;
}
