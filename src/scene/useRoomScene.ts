import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { useCork } from '../lib/store';
import type { Memory, ViewMode } from '../lib/types';
import { BOARD_H, BOARD_W } from '../lib/types';
import { memoryBounds } from '../lib/utils';
import { CORK_VIEW, COUNTER, EYE_BOX } from './layout';
import { SCENES, disposeScene, type SceneId } from './themes';
import { animateProps, buildProps, isDocked, reseat, type PlacedProp } from './props';
import { Orbit } from './orbit';
import { captureProbe, disposeNeutral, type Probe } from './probe';
import { cancelBakes } from './bake';
import { quality, useGraphics } from './quality';
import { createPost } from './post';
import { installSoftShadows } from './softShadows';
import { disposeTextures } from './textures';
import { markRoomReady } from '../lib/startup';

export interface SceneApi {
  focusOn(memory: Memory, zoom?: number): void;
  fitAll(): void;
  resetView(): void;
  zoomBy(factor: number): void;
  centerPoint(): { x: number; y: number };
  toBoard(clientX: number, clientY: number): { x: number; y: number };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * How fast the stick moves you, in the pixels per second a drag would cover.
 *
 * One rate per axis, because the two axes are not the same size. The camera
 * may swing about a hundred and ten degrees around the room and tilt through
 * forty; a single rate would cross the short one in a third of the time and
 * the stick would feel like it was falling over sideways. These put a full
 * push through the whole of either in a little under two seconds — quick
 * enough to get somewhere, slow enough to stop where you meant to.
 */
const STICK_SWING = 460;
const STICK_RISE = 230;

/**
 * The room, and the camera you look at it with.
 *
 * Two renderers over one camera: WebGL draws the room, and a CSS3D layer puts
 * the corkboard — real DOM, with every memory still a live element you can
 * drag, open and type into — onto the plane where it hangs. That is the whole
 * architecture. Photographs stay as sharp as the display can show, text stays
 * selectable and accessible, and none of it stops being true when you swing the
 * camera around to look at the desk.
 *
 * The room itself is swappable. Only the room: the renderer, the camera, the
 * board and everything you have put on the desk outlive the switch, so moving
 * from the kitchen to the studio is a change of place rather than a reload.
 *
 * Everything is drawn on demand. The rooms are static, so once the camera
 * settles the loop does nothing at all — no redraw, no shadow pass, no GPU
 * work.
 *
 * There are two ways of looking at it, and every gesture below asks which one
 * is in effect before it does anything. In the room the camera swings, the
 * props can be picked up and put down, and a double-click moves in on
 * whatever is under it. In the cork view it is square on to the board and
 * flat: drag slides, wheel zooms about the pointer, the room's furniture is
 * not pickable at all, and nothing on the way to a photograph can knock the
 * camera off axis. See `orbit.ts` for why that is a mode rather than a
 * sensitivity setting.
 */
export function useRoomScene(
  containerRef: React.RefObject<HTMLDivElement>,
  boardRef: React.RefObject<HTMLDivElement>,
  memories: Memory[],
  sceneId: SceneId,
  view: ViewMode,
  /** Pixels down the left edge that are behind chrome — see `CorkLeash`. */
  insetLeft: number,
) {
  const [zoomLabel, setZoomLabel] = useState(1);
  const [grabbing, setGrabbing] = useState(false);
  /* Where over the room to hang the laptop's own controls, and whether to hang
     them at all. Screen pixels inside the container, worked out once when they
     open — everything that would move the camera under them closes them, so
     there is never a stale one to keep up with. */
  const [finishAt, setFinishAt] = useState<{ x: number; y: number; target: 'laptop' | 'phone' } | null>(null);
  /* Half of what a tier decides — multisampling, the shadow filter, the size
     every texture was baked at — is fixed for the life of a WebGL context or
     of a texture upload. So the tier is a dependency of this effect: changing
     it tears the renderer down and builds the room again, which is the only
     honest way to apply it. Nobody does it twice in a session. */
  const { tier } = useGraphics();
  const placeProp = useCork((s) => s.placeProp);
  const select = useCork((s) => s.select);
  const setView = useCork((s) => s.setView);
  const savedProps = useCork((s) => s.props);

  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const savedPropsRef = useRef(savedProps);
  savedPropsRef.current = savedProps;
  /* The room at mount. A ref keeps its first value, which is exactly what
     "which room to build before the swap effect has run" means. */
  const firstScene = useRef(sceneId);
  /* The way of looking, for a renderer that is rebuilt when the graphics tier
     changes and has to come back up in the mode it went down in. */
  const viewRef = useRef(view);
  viewRef.current = view;
  const insetRef = useRef(insetLeft);
  insetRef.current = insetLeft;

  /* The stick, as it is being held — see `Joystick`. A ref rather than state
     because what a held control carries is a speed, and a speed belongs to
     the frame loop's clock; storing it in React would re-render the room
     sixty times a second to say the same thing twice. */
  const stick = useRef({ x: 0, y: 0 });

  const api = useRef<SceneApi | null>(null);
  const swapScene = useRef<((id: SceneId, animated: boolean) => void) | null>(null);
  const applyView = useRef<((v: ViewMode) => void) | null>(null);
  const reframe = useRef<(() => void) | null>(null);
  const handlers = useRef<{
    down(e: React.PointerEvent): void;
    move(e: React.PointerEvent): void;
    up(e: React.PointerEvent): void;
    dbl(e: React.MouseEvent): void;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const boardEl = boardRef.current;
    if (!container || !boardEl) return;

    /* ------------------------------------------------------------ setup */
    const q = quality();
    /*
     * Multisampling is asked for here or never.
     *
     * `antialias` is a property of the drawing buffer, fixed when the context
     * is created — and on a tiled mobile GPU it is not a filter but a second
     * set of colour and depth attachments, resolved every frame. It is the
     * single most expensive thing on this list and the easiest to give up,
     * because the alternative on a phone is a display dense enough that the
     * edges were never the problem.
     */
    const renderer = new THREE.WebGLRenderer({
      /*
       * Asked for only when the room goes straight to the canvas.
       *
       * With a post chain in front of it the room is drawn into a target of
       * its own and the canvas receives one full-screen triangle, which has
       * no interior edges for a multisample resolve to find. The samples move
       * onto that target instead — same cost, spent where the geometry is —
       * and asking for them here as well would pay for a second multisampled
       * buffer that nothing is ever rasterised into.
       */
      antialias: q.antialias && !q.post,
      powerPreference: q.powerPreference,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = installSoftShadows();
    // The rooms never move, so their shadows are drawn once and kept. Only a
    // prop being dragged, or a change of room, asks for another pass.
    renderer.shadowMap.autoUpdate = false;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    container.appendChild(renderer.domElement);

    const css = new CSS3DRenderer();
    css.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1';
    container.appendChild(css.domElement);

    const scene = new THREE.Scene();
    /**
     * Near and far, chosen for depth precision rather than for headroom.
     *
     * A depth buffer's resolution is spent almost entirely near the camera: the
     * far/near *ratio* is what decides how finely it can separate two surfaces
     * out where the room actually is. At 60 and 40000 that ratio was 667, which
     * left drawer faces, frames and labels fighting for the same depth value —
     * and because which one wins depends on the viewing angle, it showed up as
     * textures flickering while the camera moved and nowhere else. The camera
     * is leashed inside the room and can never get within 200 units of
     * anything, so the near plane costs nothing to push out.
     */
    const camera = new THREE.PerspectiveCamera(38, 1, 200, 30000);
    const orbit = new Orbit();

    /*
     * What everything in the room reflects.
     *
     * This used to be `RoomEnvironment` — three.js's generic grey box, built
     * as a scene of twenty meshes and rendered six times so that metal had
     * something, anything, to catch. It works, and it is why the brass read as
     * brass; but what it reflects is a studio nobody is standing in, and next
     * to a window it shows: the pulls pick up a soft grey nothing where the
     * window should be.
     *
     * Each room now captures itself instead — see `probe.ts` — which costs
     * less than building RoomEnvironment did and reflects the actual glazing,
     * the actual city, the actual plaster.
     */
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileCubemapShader();

    /*
     * And what happens to the frame once the room is in it.
     *
     * Constructed here rather than lazily, because it takes the tone curve out
     * of the materials on the way up — see `post.ts`. Doing that later would
     * mean recompiling every shader program in the room at the moment it
     * happened. On the bottom tier it constructs to a pass-through and the
     * renderer keeps its own tone mapping, so nothing below has to ask which
     * it got.
     */
    const post = createPost(renderer);

    /* --------------------------------------------------- the DOM board */
    const cssScene = new THREE.Scene();
    const boardObject = new CSS3DObject(boardEl);
    cssScene.add(boardObject);

    /* ------------------------------------------------------ raycasting */
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -COUNTER.top);
    const hit = new THREE.Vector3();

    /** Screen pixels to −1..1 across the canvas, +Y up. */
    const setNdc = (clientX: number, clientY: number) => {
      const box = container.getBoundingClientRect();
      pointer.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    };
    const setPointer = (clientX: number, clientY: number) => {
      setNdc(clientX, clientY);
      ray.setFromCamera(pointer, camera);
    };
    const onPlane = (plane: THREE.Plane) => (ray.ray.intersectPlane(plane, hit) ? hit : null);

    /* --------------------------------------------------- the room itself */
    let active = SCENES[firstScene.current];
    let room: THREE.Group | null = null;
    /*
     * Built once each, then kept.
     *
     * Swapping used to dispose the room being left and build the one being
     * entered from nothing, which was affordable when a room was a hundred
     * boxes and is not now that it is a hundred boxes plus a quarter of a
     * million rays and a cubemap capture. Two finished rooms are a couple of
     * megabytes of geometry between them, and holding both turns the switch
     * from a visible hitch into a cut.
     */
    const rooms = new Map<SceneId, { group: THREE.Group; probe: Probe }>();
    /** False until the reader moves the camera themselves. */
    let touched = false;
    /** Square on to the board, two axes. */
    let cork = false;
    /** What `touched` was when the cork view was entered, to go back to. */
    let roomTouched = false;
    let needsRender = true;
    /** True once a struggling machine has given up the decorative light. */
    let shedDone = false;
    /** And once it has given up shadows that work out their own softness. */
    let hardDone = false;

    /**
     * Put away anything marked as the first thing to go.
     *
     * Rooms are built once and kept, and the one being switched to may have
     * been built before the machine started struggling — or not built yet at
     * all. Either way it arrives with its beams switched on, so a phone that
     * has already given them up in the kitchen would get them back by walking
     * into the studio. Applied to each room as it comes in, rather than only
     * at the moment of giving up.
     */
    const hideShed = (root: THREE.Object3D) => {
      let found = false;
      root.traverse((o) => {
        if (o.userData.shed && o.visible) {
          o.visible = false;
          found = true;
        }
      });
      return found;
    };

    /**
     * Put every light's shadow back on the single cheap tap.
     *
     * A rung the frame-time ladder can reach without recompiling anything,
     * which is the whole reason it is spelled this way. The filter in
     * `softShadows.ts` reads a light's radius as its size and takes the cheap
     * branch at zero — so setting the radius is all it takes to go from two
     * dozen texture fetches per shadowed pixel to one, instantly, with no
     * shader rebuild and therefore no stall at the exact moment the machine
     * is already behind.
     *
     * Applied to each room as it arrives as well as to the one in the scene,
     * for the same reason `hideShed` is: a room built after the machine gave
     * up would otherwise walk back in with everything switched on.
     */
    const hardenShadows = (root: THREE.Object3D) => {
      let found = false;
      root.traverse((o) => {
        const light = o as THREE.Light & { shadow?: THREE.LightShadow };
        if (light.shadow && light.shadow.radius > 0) {
          light.shadow.radius = 0;
          found = true;
        }
      });
      return found;
    };

    /** The room is drawn on demand, so anything that lands later has to ask. */
    const invalidate = () => {
      renderer.shadowMap.needsUpdate = true;
      needsRender = true;
    };

    /** Board pixels ⇄ world: the board hangs at one unit per CSS pixel. */
    const boardToWorld = (x: number, y: number) =>
      new THREE.Vector3(
        active.board.centreX - BOARD_W / 2 + x,
        active.board.centreY + BOARD_H / 2 - y,
        active.board.z,
      );

    const openOn = (instant: boolean) => {
      const f = active.framing(camera.aspect || 1.6);
      camera.fov = f.fov;
      camera.updateProjectionMatrix();
      orbit.set(new THREE.Vector3(...f.target), f.radius, f.theta, f.phi, instant);
    };

    /**
     * Where the cork view may go — for the board as it hangs now, seen through
     * the window it is being seen through now.
     *
     * Both of those move: the board hangs in a different place in each room,
     * and the lens widens as the viewport narrows, which changes how far back
     * the whole board needs the camera to be. So this is solved fresh on every
     * entry, resize and change of room rather than kept as a constant.
     */
    const corkLeash = () => {
      const b = active.board;
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      /* Everything horizontal here is measured against the part of the window
         the sidebar is not sitting on. */
      const insetFrac = clamp(insetRef.current / Math.max(1, container.clientWidth), 0, 0.5);
      const wide = (camera.aspect || 1.6) * (1 - insetFrac);
      const fitH = BOARD_H / 2 / tanHalf;
      const fit = Math.max(fitH, BOARD_W / 2 / tanHalf / wide);
      /* The far limit belongs as much to the room as to the board: there is a
         wall behind the camera, and through a tall narrow window it is reached
         before the board's own edges are. The near one is where the plaster
         the board hangs on would be crossed. */
      const minRadius = Math.max(CORK_VIEW.minRadius, EYE_BOX.minZ - b.z);
      const maxRadius = Math.max(minRadius, Math.min(fit * CORK_VIEW.pullback, EYE_BOX.maxZ - b.z));
      return {
        leash: {
          centreX: b.centreX,
          centreY: b.centreY,
          z: b.z,
          /* A little past the edge on every side, because an item is allowed
             to overhang one and you have to be able to see it to fix it. */
          halfW: BOARD_W / 2 + CORK_VIEW.margin,
          halfH: BOARD_H / 2 + CORK_VIEW.margin,
          insetFrac,
          minRadius,
          maxRadius,
        },
        /* Far enough back for the board, or for as much of it as is worth
           seeing at once — whichever is nearer. See `minFill`. */
        start: Math.min(fit * CORK_VIEW.padding, fitH / CORK_VIEW.minFill),
      };
    };

    /** Move in on the board, square on. Also re-frames if already there. */
    const enterCork = (instant: boolean) => {
      if (!cork) roomTouched = touched;
      cork = true;
      const { leash, start } = corkLeash();
      orbit.enterCork(leash, start, camera, instant);
      touched = false;
      needsRender = true;
    };

    /** Back to the room, and to whatever was true of the camera before. */
    const leaveCork = () => {
      if (!cork) return;
      cork = false;
      touched = roomTouched;
      if (!orbit.exitCork()) openOn(false);
      needsRender = true;
    };

    applyView.current = (v) => (v === 'cork' ? enterCork(false) : leaveCork());
    reframe.current = () => {
      if (!cork) return;
      if (touched) orbit.releash(corkLeash().leash, camera);
      else enterCork(false);
    };

    /*
     * Which way the light falls on the board, from where the camera is now.
     *
     * The board is the one part of this scene the renderer never touches. It
     * is live DOM sitting on a CSS3D plane — real photographs, real text, real
     * inputs — and a browser laying out a drop shadow has no way of knowing
     * that there is a window three metres to the right of it. So every shadow
     * on it was cast straight down, in every room, at every angle, while
     * everything around it was lit by a sun.
     *
     * This is the two numbers that fix that. The room's key light and the
     * middle of the board are both projected into screen space and one is
     * subtracted from the other, which gives the direction a shadow on the
     * board should fall — in the same pixels the browser is about to draw it
     * in. Swing the camera and it swings; walk into the studio, where the
     * light is two shades hanging directly overhead rather than a window off
     * to one side, and every shadow on the board shortens and straightens.
     *
     * The angle goes out alongside the vector because CSS can multiply a
     * number but cannot take an arctangent, and the sheen across a photograph
     * is a gradient, which needs one.
     */
    const lightFrom = new THREE.Vector3();
    const boardCentre = new THREE.Vector3();
    const publishLight = () => {
      lightFrom.set(...active.keyLight).project(camera);
      boardCentre.copy(boardToWorld(BOARD_W / 2, BOARD_H / 2)).project(camera);
      /* Screen space, so y is flipped: the projection puts +y up and every
         shadow offset below is written in CSS pixels, where +y is down. */
      let x = boardCentre.x - lightFrom.x;
      let y = lightFrom.y - boardCentre.y;
      const length = Math.hypot(x, y);
      if (length < 1e-4) {
        // dead overhead, or as near as makes no difference
        x = 0;
        y = 1;
      } else {
        x /= length;
        y /= length;
      }
      boardEl.style.setProperty('--cast-x', x.toFixed(3));
      boardEl.style.setProperty('--cast-y', y.toFixed(3));
      // 0deg points a CSS gradient at the top of the box; 90deg at its right
      boardEl.style.setProperty('--cast-deg', `${((Math.atan2(x, -y) * 180) / Math.PI).toFixed(1)}deg`);
    };

    const applyScene = (id: SceneId, animated: boolean) => {
      if (room && active.id === id) return;
      if (room) scene.remove(room);
      active = SCENES[id];

      scene.background = new THREE.Color(active.background);
      renderer.toneMappingExposure = active.exposure;
      container.style.backgroundColor = active.pageColour;
      boardEl.dataset.scene = id;

      let entry = rooms.get(id);
      if (!entry) {
        const group = active.build(invalidate);
        scene.add(group);
        /* Captured with the room in the scene and the props out of it: a mug
           left in the reflection would still be there after being moved, and
           a mirror that remembers is worse than one that only approximates. */
        renderer.shadowMap.needsUpdate = true;
        entry = {
          group,
          probe: captureProbe(
            renderer,
            pmrem,
            scene,
            new THREE.Vector3(...active.probeAt),
            q.probe,
            [props.group],
            q.tier === 'high' ? 2 : 1,
          ),
        };
        rooms.set(id, entry);
      } else {
        scene.add(entry.group);
      }
      room = entry.group;
      if (shedDone) hideShed(entry.group);
      if (hardDone) hardenShadows(entry.group);
      scene.environment = entry.probe.texture;
      scene.environmentIntensity = active.envIntensity;
      post.setSource(new THREE.Vector3(...active.scatterFrom), active.scatterTint);
      post.setGrade(active.grade);
      /* Immediately rather than on the next throttled tick: a room swap
         changes where the light is by a right angle, and a board that keeps
         the old room's shadows for a tenth of a second is a visible wrong. */
      publishLight();

      /* The two desks are different lengths, so anything left standing off the
         end of the shorter one is nudged back onto it. Only the mesh moves —
         what is saved stays put, so switching back finds it where you left
         it. */
      for (const p of props.placed) {
        const b = active.deskBounds;
        p.group.position.x = clamp(p.group.position.x, b.minX, b.maxX);
        p.group.position.z = clamp(p.group.position.z, b.minZ, b.maxZ);
      }

      boardObject.position.set(active.board.centreX, active.board.centreY, active.board.z);
      // Plane constant is the *negated* distance along the normal, so a board
      // that moves off the wall moves this with it or every drop lands short.
      boardPlane.constant = -active.board.z;

      touched = false;
      if (cork) {
        /* The board moved to another wall. Re-frame on it where it is now, and
           make the way back out land in the room we are in rather than in the
           one we left. */
        const f = active.framing(camera.aspect || 1.6);
        camera.fov = f.fov;
        camera.updateProjectionMatrix();
        orbit.parkAt(new THREE.Vector3(...f.target), f.radius, f.theta, f.phi);
        enterCork(!animated);
      } else {
        openOn(!animated);
      }
      renderer.shadowMap.needsUpdate = true;
      needsRender = true;
    };
    swapScene.current = applyScene;

    /* ------------------------------------------------------------- props */
    const props = buildProps(savedPropsRef.current, invalidate);
    scene.add(props.group);

    applyScene(firstScene.current, false);
    /* A change of graphics tier tears this whole effect down and builds it
       again; the mode it was in is React's, and outlives that. */
    if (viewRef.current === 'cork') enterCork(true);

    /* ------------------------------------------------------- the loop */
    let raf = 0;
    let last = performance.now();
    /**
     * Resolution is chosen once, and only ever lowered.
     *
     * This used to drop to a coarse ratio whenever the camera moved and climb
     * back when it stopped, which sounds thrifty and is the opposite. Drawing a
     * frame costs about a millisecond — the scene is a hundred and fifty boxes —
     * while *resizing the drawing buffer* costs five, because it reallocates
     * the colour, depth and multisample attachments together. Flipping it on
     * every gesture start and every gesture end paid that price twice per
     * scroll of the wheel, to save work that was never the bottleneck. It was
     * the lag.
     *
     * So: pick a ratio, keep it, and step down only if the machine turns out to
     * need it — at most twice in a session, never back up, never mid-gesture
     * for its own sake.
     */
    /* Multipliers on whatever the budget below works out to, rather than
       ratios in their own right: the ceiling is the tier's business and this
       is only the machine saying it cannot keep up with it. */
    const DPR_SCALE = [1, 0.82, 0.66, 0.52];
    let dprStep = 0;
    /**
     * Seconds owed: how far behind a comfortable frame the machine has fallen,
     * summed while the camera is moving.
     *
     * This counted slow frames before, which treats a frame that took thirty
     * milliseconds and one that took a hundred and fifty as the same evidence
     * and needs two dozen of either before it acts. A phone that is three
     * times too slow should be helped three times as fast, and a phone that
     * is barely missing should mostly be left alone — so what accumulates is
     * the overrun itself. A machine at 15fps crosses the threshold in four
     * frames; one hovering at 40 takes a couple of seconds to get there, and
     * one that hitches once never does, because a fast frame pays the debt
     * back down again.
     *
     * The floor on how far it can be paid down is what stops a long smooth
     * stretch buying immunity that then has to be spent before anything can
     * happen — which is exactly the shape of a phone that runs beautifully
     * for ninety seconds and then gets hot. Tensor is the part this is here
     * for: nothing asked at load can see a thermal envelope, so the only
     * honest way to find it is to keep watching.
     */
    let debt = 0;
    /** A comfortable frame. Above 45fps nobody is looking for the difference. */
    const BUDGET = 0.022;

    const applyDpr = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      /*
       * Two ceilings, because a ratio alone is not a budget.
       *
       * Device pixel ratio says how dense the panel is, not how many pixels
       * there are: a phone at ratio three is a million of them, and a 4K
       * display at ratio one is eight million. The cost of this scene is
       * almost entirely the second number, so the second number is what gets
       * capped — the ratio is then whatever fits under it.
       */
      const area = Math.max(1, w * h);
      const ratio = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio, Math.sqrt(q.maxPixels / area));
      renderer.setPixelRatio(Math.max(0.62, ratio * DPR_SCALE[dprStep]));
      renderer.setSize(w, h, false);
    };

    /**
     * One rung down.
     *
     * The air first, and then the pixels. The beam of sunlight and the patch
     * it lands in are two draws, but they are additive, screen-sized and
     * depth-sorted — on a tiled GPU they cost far more than their two draws
     * suggest, and more than the twenty per cent of pixels the next rung
     * would save. So they go at the first sign of trouble and the resolution
     * holds one step longer, which is the right way round: a slightly softer
     * room still reads as the room, and a room at half resolution is a
     * different and worse-looking place.
     *
     * Nothing here comes back. Resizing the drawing buffer reallocates its
     * colour, depth and multisample attachments together and costs about five
     * milliseconds, so a ladder that climbed as well as fell would spend more
     * on changing its mind than it ever saved.
     */
    const relieve = () => {
      if (!shedDone) {
        shedDone = true;
        /* A rung that actually gave something back need not also cost pixels.
           On a tier with no air in it there was nothing to give, so fall
           through and take the resolution instead. */
        if (hideShed(scene)) return;
      }
      /* Then the scattered light and the occlusion — whole passes over the
         frame, given up before anything that changes how the room is shaded.
         On a handheld there are neither, and this falls straight through
         rather than spending a rung saying so. See `Post.relieve`. */
      if (post.relieve()) return;
      /*
       * Then the softness of the shadows, which is the last thing here that
       * is a look rather than a resolution.
       *
       * It goes late because it is the most missed: a shadow that spreads as
       * it travels is most of what stops the room looking like a diagram.
       * But it is also, by some distance, the most expensive thing left —
       * measured at about half of everything it costs to draw the room, which
       * is more than the next three rungs put together. So it goes before the
       * resolution does, because a slightly harder room still reads as the
       * room and a room at half resolution does not.
       *
       * Only where the tier has it to give, which is now neither a handheld
       * nor the bottom tier. Without the two passes installed, `shadow.radius`
       * no longer means the size of the light — it means how far apart
       * three.js spreads nine fixed taps — and zeroing it does not skip any of
       * the nine. It collapses them onto one texel and hands back a shadow
       * with the map's own staircase in it, for no saving at all: a rung that
       * costs a look and buys nothing, which is the one shape a ladder must
       * not have. So it is skipped rather than spent, and the resolution goes
       * instead.
       */
      if (q.softShadows && !hardDone) {
        hardDone = true;
        if (hardenShadows(scene)) {
          renderer.shadowMap.needsUpdate = true;
          return;
        }
      }
      /* And then the tail of the bloom pyramid, which is small — small enough
         that it has to come after the shadows rather than before them, or a
         phone spends its first rung on nothing. See `Post.thin`. */
      if (post.thin()) return;
      if (dprStep >= DPR_SCALE.length - 1) return;
      dprStep++;
      applyDpr();
    };

    /** Set while the camera is in flight; see `.board-moving`. */
    let boardMoving = false;
    let stillSince = 0;

    /** How many screen pixels one board unit covers — the app's "zoom". */
    let shownZoom = 0;
    /* The readout is a React render, and a React render is the whole subtree.
       It does not need to happen sixty times a second to read as live. */
    let labelAt = 0;
    /** And the same for the light direction, which is written the same way. */
    let lightAt = 0;
    const measureZoom = () => {
      const a = boardToWorld(0, BOARD_H / 2).project(camera);
      const b = boardToWorld(BOARD_W, BOARD_H / 2).project(camera);
      return (Math.abs(b.x - a.x) * container.clientWidth) / 2 / BOARD_W;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      /*
       * Two readings of the same gap, for two different jobs.
       *
       * The clamp exists so that a tab coming back from the background does
       * not integrate four minutes of camera motion in one step. That makes
       * it exactly the wrong number to judge the machine by: it caps a
       * hundred-and-fifty-millisecond frame at fifty and reports a phone in
       * trouble as a phone that is merely late. So the health signal reads
       * the gap as it actually was, and throws away only the gaps that are
       * plainly not frames at all.
       */
      const raw = (now - last) / 1000;
      const dt = Math.min(0.05, raw);
      last = now;

      /*
       * The stick, integrated.
       *
       * Held rather than pressed, so what it carries is a rate, and a rate is
       * applied here on the frame's own clock rather than pushed in from an
       * input handler — the same degrees per second whether the phone is
       * managing sixty frames or thirty. It is fed to `rotate` in pixels
       * because pixels are what a drag feeds it: the stick is that same
       * gesture on a screen with nowhere to put your thumb, and the two
       * should not arrive at different sensitivities.
       *
       * Negated, though, and that is the whole of the difference between
       * them. A drag pushes the room past you; the stick moves *you*. Push it
       * right and you walk right around the counter, push it up and you stand
       * taller and the counter opens out below — which is the opposite sign,
       * and the reason this is not simply wired to the same call.
       */
      const held = stick.current;
      if (!cork && (held.x !== 0 || held.y !== 0)) {
        touched = true;
        orbit.rotate(-held.x * STICK_SWING * dt, -held.y * STICK_RISE * dt);
      }

      const moving = orbit.update(camera, dt);
      if (moving) {
        needsRender = true;
        stillSince = now;
        if (!boardMoving) {
          boardMoving = true;
          boardEl.classList.add('board-moving');
        }
        /* Only a sustained struggle counts, so one hitch never costs a step.
           Anything past half a second is a tab resuming or a long task
           somewhere else on the page, and neither is the renderer's fault. */
        if (raw < 0.5) {
          debt = clamp(debt + raw - BUDGET, -0.12, 0.6);
          /*
           * Two thirds of a second of sustained trouble, not a whole one.
           *
           * The threshold is a time: at three hundred milliseconds of
           * accumulated lateness, a phone managing thirty frames a second
           * took most of a second to give up each rung, and five rungs took
           * five seconds — which is five seconds of the exact stutter the
           * ladder exists to end, every time the reader swings the camera.
           * Reacting sooner costs a machine that hitched once nothing,
           * because a single slow frame still cannot reach two hundred
           * milliseconds on its own and anything over half a second is
           * discarded above as not a frame at all.
           */
          if (debt > 0.2) {
            relieve();
            debt = 0;
          }
        }
      } else if (boardMoving && now - stillSince > 140) {
        // Handled before the early-out below, because when the camera is at
        // rest there is no frame to hang it off.
        boardMoving = false;
        boardEl.classList.remove('board-moving');
      }
      /* The charging screen, which is the one thing here that moves on its
         own — and which is given the camera so it can decline to move when it
         is behind you. See `animateProps`. */
      if (animateProps(now / 1000, camera)) needsRender = true;

      if (!needsRender) return;
      needsRender = false;

      post.render(scene, camera);
      css.render(cssScene, camera);
      markRoomReady();
      // it starts hidden so it can't flash at the top-left corner for a frame
      if (boardEl.style.visibility !== 'visible') boardEl.style.visibility = 'visible';

      /*
       * Written on the same throttle as `--inv-zoom`, and for the same
       * reason: these are inherited custom properties, so each write
       * invalidates style for every memory on the board and everything
       * inside them. Once every ninth of a second while the camera is in
       * flight is far more often than a shadow needs to move to read as
       * attached to the light, and exact the moment it lands.
       */
      if (!moving || now - lightAt > 110) {
        lightAt = now;
        publishLight();
      }

      const z = measureZoom();
      if (Math.abs(z - shownZoom) > 0.004) {
        shownZoom = z;
        /*
         * Both of these are throttled while the camera is in flight and exact
         * the moment it lands. The label is a React render of the whole board
         * subtree; `--inv-zoom` is worse, because it is an *inherited* custom
         * property — writing it invalidates style for every item on the board
         * and everything inside them. Sixty times a second during a fast zoom,
         * that was most of the cost of a fast zoom.
         */
        if (!moving || now - labelAt > 110) {
          labelAt = now;
          boardEl.style.setProperty('--inv-zoom', String(1 / Math.max(z, 0.02)));
          setZoomLabel(z);
        }
      }
    };

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      applyDpr();
      css.setSize(w, h);
      // A lens wide enough for a laptop takes in a metre of wall on a phone
      // held upright, and there is nowhere further back to stand.
      camera.fov = active.framing(camera.aspect).fov;
      camera.updateProjectionMatrix();
      // Rotating a phone changes what the room can even fit; until the reader
      // has moved the camera themselves, re-frame rather than crop.
      if (cork) {
        if (touched) orbit.releash(corkLeash().leash, camera);
        else enterCork(true);
      } else if (!touched) openOn(true);
      renderer.shadowMap.needsUpdate = true;
      needsRender = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    raf = requestAnimationFrame(frame);

    /* ------------------------------------------------------ interaction */
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'orbit' | 'pan' | 'prop' | 'pinch' = 'none';
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    let dragged: PlacedProp | null = null;
    let grabOffset = new THREE.Vector3();
    let pinchDist = 0;

    const propAt = (clientX: number, clientY: number): PlacedProp | null => {
      setPointer(clientX, clientY);
      const hits = ray.intersectObjects(props.group.children, true);
      const id = hits[0]?.object.userData.propId;
      return id ? (props.placed.find((p) => p.def.id === id) ?? null) : null;
    };

    /*
     * Rest on the laptop and its colours come up over it.
     *
     * Dwell rather than plain hover, and it has to be dwell: the same pointer
     * that hovers the laptop is the one that swings the room and picks things
     * up off the counter, so anything that appeared the instant you crossed it
     * would spend the day appearing while somebody was on their way somewhere
     * else. Stopping on a thing is the one hover that means you meant it.
     *
     * Slow to arrive and quick to leave, which is the only tolerable way round
     * for something that shows up under the pointer uninvited: it waits out the
     * dwell to open, and closes on the first move that lands anywhere else.
     */
    const DWELL = 600;
    let dwell = 0;
    let restX = -999;
    let restY = -999;
    let showing: 'laptop' | 'phone' | null = null;

    const closeFinish = () => {
      window.clearTimeout(dwell);
      dwell = 0;
      if (!showing) return;
      showing = null;
      setFinishAt(null);
    };

    /** Over the highest point of a prop, in pixels down and across the room. */
    const above = (prop: PlacedProp) => {
      const box = new THREE.Box3().setFromObject(prop.group);
      const v = new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        box.max.y,
        (box.min.z + box.max.z) / 2,
      ).project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * container.clientWidth,
        y: (-v.y * 0.5 + 0.5) * container.clientHeight,
      };
    };

    const hover = (e: React.PointerEvent) => {
      /* A finger has no hover, and square on to the board nothing in the room
         is pickable — in neither case is resting on something a question. */
      if (cork || e.pointerType === 'touch') return;
      /* The panel is over the room but not of it: moving onto it is not moving
         off the laptop, and it cancels whatever close was pending. */
      if ((e.target as HTMLElement).closest('[data-finish]')) {
        window.clearTimeout(dwell);
        return;
      }
      if (Math.hypot(e.clientX - restX, e.clientY - restY) < 3) return;
      restX = e.clientX;
      restY = e.clientY;
      window.clearTimeout(dwell);

      if (showing) {
        // a moment's grace, so the pointer can cross the gap to the panel
        if (propAt(e.clientX, e.clientY)?.def.id !== showing) {
          dwell = window.setTimeout(closeFinish, 240);
        }
        return;
      }
      dwell = window.setTimeout(() => {
        const prop = propAt(restX, restY);
        if (prop?.def.id !== 'laptop' && prop?.def.id !== 'phone') return;
        showing = prop.def.id;
        setFinishAt({ ...above(prop), target: showing });
      }, DWELL);
    };

    /** Where on the wall a screen point lands — what the cork view zooms about. */
    const boardPointAt = (clientX: number, clientY: number) => {
      setPointer(clientX, clientY);
      return onPlane(boardPlane);
    };

    const down = (e: React.PointerEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-board-chrome]') || el.closest('[data-memory-id]')) return;
      // anything that starts here is about to move the room out from under them
      closeFinish();

      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        mode = 'pinch';
        return;
      }

      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* A pointer the browser has already finished with. Capture is a
           convenience here — without it a drag still tracks, it just stops at
           the edge of the element — and letting this throw would abandon the
           rest of the gesture set-up half done. */
      }

      /* In the cork view the room's furniture is not pickable, and a drag is
         a slide rather than a swing. Both for the same reason: a gesture aimed
         at the board that lands a few pixels off it should do nothing you have
         to undo — not move a mug, not turn the room. */
      const flat = cork || e.shiftKey || e.button === 1;
      const prop = flat ? null : propAt(e.clientX, e.clientY);
      if (prop) {
        mode = 'prop';
        dragged = prop;
        const p = onPlane(deskPlane);
        grabOffset = p ? prop.group.position.clone().sub(p) : new THREE.Vector3();
        setGrabbing(true);
        return;
      }
      mode = flat ? 'pan' : 'orbit';
      setGrabbing(true);
    };

    const move = (e: React.PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (mode === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        touched = true;
        const factor = d / pinchDist;
        // square on, a pinch holds the cork between the fingers where it is
        if (cork) {
          setNdc((a.x + b.x) / 2, (a.y + b.y) / 2);
          orbit.dollyAt(factor, pointer.x, pointer.y);
        } else orbit.dolly(factor);
        pinchDist = d;
        return;
      }
      if (mode === 'none') {
        hover(e);
        return;
      }

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!moved && Math.hypot(dx, dy) > 2) moved = true;

      if (mode === 'orbit') {
        touched = true;
        orbit.rotate(dx, dy);
      } else if (mode === 'pan') {
        touched = true;
        orbit.pan(dx, dy, camera, container.clientHeight);
      } else if (mode === 'prop' && dragged) {
        setPointer(e.clientX, e.clientY);
        const p = onPlane(deskPlane);
        if (!p) return;
        const b = active.deskBounds;
        dragged.group.position.set(
          clamp(p.x + grabOffset.x, b.minX, b.maxX),
          COUNTER.top,
          clamp(p.z + grabOffset.z, b.minZ, b.maxZ),
        );
        // the magnet gets a say before the frame does
        reseat(props.placed, dragged.def.id);
        renderer.shadowMap.needsUpdate = true;
        needsRender = true;
      }
    };

    /*
     * The release nobody saw.
     *
     * A finger that goes down on the room and comes up somewhere that is not
     * the room — over a sheet that opened under it, a tour that covered it,
     * anything mounted outside this container — never reaches the handler
     * below, and its id stays in the map. The next single touch then makes the
     * map two long, which is the signature of a pinch, and from then on every
     * one-finger drag is read as a gesture with a missing second finger: the
     * room simply stops answering. So the window gets the last word on which
     * pointers are still down, whatever they happened to come up over.
     */
    const release = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size || mode === 'none') return;
      mode = 'none';
      dragged = null;
      setGrabbing(false);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    const up = (e: React.PointerEvent) => {
      pointers.delete(e.pointerId);
      if (mode === 'prop' && dragged) {
        reseat(props.placed, dragged.def.id);
        placeProp(dragged.def.id, {
          x: Math.round(dragged.group.position.x),
          z: Math.round(dragged.group.position.z),
          rotation: Number(dragged.group.rotation.y.toFixed(3)),
          ...(dragged.def.id === 'phone' ? { docked: isDocked() } : null),
        });
      }
      if (mode !== 'none' && !moved && !(e.target as HTMLElement).closest('[data-memory-id]')) {
        select(null);
      }
      mode = 'none';
      dragged = null;
      setGrabbing(false);
    };

    /**
     * Double-click the room to move in on it: a prop, or the cork.
     *
     * On the cork it does more than move in — it goes square on and stays
     * there, because "closer to the board" and "done swinging the room about"
     * are the same wish. Nothing here fires in the cork view: there is no
     * third thing for a double-click to mean once you are already in front of
     * the board, and a gesture that means nothing is better than one that
     * surprises you.
     */
    const dbl = (e: React.MouseEvent) => {
      if (cork) return;
      const el = e.target as HTMLElement;
      if (el.closest('[data-board-chrome]')) return;
      /* A memory opens on the first of the two clicks, so by the time the
         second lands its card is over the board — and moving the camera
         behind an open card is a change you cannot see happening. */
      if (el.closest('[data-memory-id]')) return;
      const prop = propAt(e.clientX, e.clientY);
      if (prop) {
        touched = true;
        orbit.focus(new THREE.Box3().setFromObject(prop.group), camera, 2.1);
        return;
      }
      const p = boardPointAt(e.clientX, e.clientY);
      const b = active.board;
      if (p && Math.abs(p.x - b.centreX) < BOARD_W / 2 && Math.abs(p.y - b.centreY) < BOARD_H / 2) {
        setView('cork');
      }
    };

    const wheel = (e: WheelEvent) => {
      closeFinish();
      e.preventDefault();
      touched = true;
      const factor = Math.exp(-e.deltaY * 0.0016);
      if (e.shiftKey) orbit.pan(-e.deltaY, 0, camera, container.clientHeight);
      else if (cork) {
        setNdc(e.clientX, e.clientY);
        orbit.dollyAt(factor, pointer.x, pointer.y);
      } else orbit.dolly(factor);
    };
    container.addEventListener('wheel', wheel, { passive: false });

    handlers.current = { down, move, up, dbl };
    /* ------------------------------------------------------------- api */
    const boardBox = (items: Memory[]) => {
      if (!items.length) {
        return new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(active.board.centreX, active.board.centreY, active.board.z),
          new THREE.Vector3(BOARD_W, BOARD_H, 100),
        );
      }
      const b = new THREE.Box3();
      for (const m of items) {
        const r = memoryBounds(m);
        b.expandByPoint(boardToWorld(r.x, r.y));
        b.expandByPoint(boardToWorld(r.x + r.w, r.y + r.h));
      }
      b.expandByScalar(180);
      return b;
    };

    api.current = {
      focusOn(memory) {
        touched = true;
        const r = memoryBounds(memory);
        const b = new THREE.Box3()
          .expandByPoint(boardToWorld(r.x, r.y))
          .expandByPoint(boardToWorld(r.x + r.w, r.y + r.h))
          .expandByScalar(220);
        orbit.focus(b, camera, 1.5);
      },
      fitAll() {
        touched = true;
        orbit.focus(boardBox(memoriesRef.current), camera, 1.25);
      },
      resetView() {
        /* In the cork view "reset" is the board, framed — going back to the
           room is what the view control itself is for. */
        if (cork) enterCork(false);
        else {
          touched = false;
          openOn(false);
        }
      },
      zoomBy(factor) {
        touched = true;
        orbit.dolly(factor);
      },
      centerPoint() {
        const box = container.getBoundingClientRect();
        return this.toBoard(box.left + box.width / 2, box.top + box.height / 2);
      },
      toBoard(clientX, clientY) {
        setPointer(clientX, clientY);
        const p = onPlane(boardPlane);
        if (!p) return { x: BOARD_W / 2, y: BOARD_H / 2 };
        return {
          x: p.x - (active.board.centreX - BOARD_W / 2),
          y: active.board.centreY + BOARD_H / 2 - p.y,
        };
      },
    };

    /* --------------------------------------------------------- teardown */
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener('wheel', wheel);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.clearTimeout(dwell);
      handlers.current = null;
      api.current = null;
      swapScene.current = null;
      applyView.current = null;
      reframe.current = null;
      for (const entry of rooms.values()) {
        disposeScene(entry.group);
        entry.probe.dispose();
      }
      rooms.clear();
      cancelBakes();
      disposeNeutral();
      pmrem.dispose();
      disposeScene(props.group, false);
      /* Textures are cached across builds and sized to the tier that built
         them, so the one thing that must not survive a teardown is the cache:
         a rebuild at another tier would otherwise reuse the old sizes and the
         setting would appear to do nothing. */
      disposeTextures();
      post.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      // hand the board back so React still owns a node that is in the document
      if (boardEl.parentElement) container.appendChild(boardEl);
      css.domElement.remove();
    };
    // Built once. Memories, props, the room and the callbacks are all reached
    // through refs, so nothing here rebuilds a renderer to add a photograph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, boardRef, placeProp, select, setView, tier]);

  /* Changing room swaps the group under the same camera and renderer. */
  useEffect(() => {
    swapScene.current?.(sceneId, true);
  }, [sceneId]);

  /* Changing the way of looking moves the same camera onto a different leash. */
  useEffect(() => {
    applyView.current?.(view);
  }, [view]);

  /* The sidebar coming or going changes how much of the board can be seen,
     which is half of what the cork view's framing is solved against. */
  useEffect(() => {
    reframe.current?.();
  }, [insetLeft]);

  const onPointerDown = useCallback((e: React.PointerEvent) => handlers.current?.down(e), []);
  const onPointerMove = useCallback((e: React.PointerEvent) => handlers.current?.move(e), []);
  const onPointerUp = useCallback((e: React.PointerEvent) => handlers.current?.up(e), []);
  const onDoubleClick = useCallback((e: React.MouseEvent) => handlers.current?.dbl(e), []);

  const focusOn = useCallback((m: Memory, zoom?: number) => api.current?.focusOn(m, zoom), []);
  const fitAll = useCallback(() => api.current?.fitAll(), []);
  const resetView = useCallback(() => api.current?.resetView(), []);
  const zoomBy = useCallback((f: number) => api.current?.zoomBy(f), []);
  const centerPoint = useCallback(
    () => api.current?.centerPoint() ?? { x: BOARD_W / 2, y: BOARD_H / 2 },
    [],
  );
  const toBoard = useCallback(
    (x: number, y: number) => api.current?.toBoard(x, y) ?? { x: BOARD_W / 2, y: BOARD_H / 2 },
    [],
  );

  /** Where the stick is being held: each −1..1, zero for centred. */
  const nudge = useCallback((x: number, y: number) => {
    stick.current.x = x;
    stick.current.y = y;
  }, []);

  return {
    zoomLabel,
    grabbing,
    finishAt,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    focusOn,
    fitAll,
    resetView,
    zoomBy,
    centerPoint,
    toBoard,
    nudge,
  };
}
