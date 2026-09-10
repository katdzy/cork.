import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useCork } from '../lib/store';
import type { Memory } from '../lib/types';
import { BOARD_H, BOARD_W } from '../lib/types';
import { memoryBounds } from '../lib/utils';
import { COUNTER } from './layout';
import { SCENES, disposeScene, type SceneId } from './themes';
import { buildProps, type PlacedProp } from './props';
import { Orbit } from './orbit';

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
 */
export function useRoomScene(
  containerRef: React.RefObject<HTMLDivElement>,
  boardRef: React.RefObject<HTMLDivElement>,
  memories: Memory[],
  sceneId: SceneId,
) {
  const [zoomLabel, setZoomLabel] = useState(1);
  const [grabbing, setGrabbing] = useState(false);
  const placeProp = useCork((s) => s.placeProp);
  const select = useCork((s) => s.select);
  const savedProps = useCork((s) => s.props);

  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const savedPropsRef = useRef(savedProps);
  savedPropsRef.current = savedProps;
  /* The room at mount. A ref keeps its first value, which is exactly what
     "which room to build before the swap effect has run" means. */
  const firstScene = useRef(sceneId);

  const api = useRef<SceneApi | null>(null);
  const swapScene = useRef<((id: SceneId, animated: boolean) => void) | null>(null);
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
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // A neutral room, prefiltered, so every material has something to reflect.
    // Without it metal reads as flat grey and ceramic loses its sheen.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

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

    const setPointer = (clientX: number, clientY: number) => {
      const box = container.getBoundingClientRect();
      pointer.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
    };
    const onPlane = (plane: THREE.Plane) => (ray.ray.intersectPlane(plane, hit) ? hit : null);

    /* --------------------------------------------------- the room itself */
    let active = SCENES[firstScene.current];
    let room: THREE.Group | null = null;
    /** False until the reader moves the camera themselves. */
    let touched = false;
    let needsRender = true;

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

    const applyScene = (id: SceneId, animated: boolean) => {
      if (room && active.id === id) return;
      if (room) {
        scene.remove(room);
        disposeScene(room);
      }
      active = SCENES[id];
      room = active.build();
      scene.add(room);

      scene.background = new THREE.Color(active.background);
      scene.environmentIntensity = active.envIntensity;
      renderer.toneMappingExposure = active.exposure;
      container.style.backgroundColor = active.pageColour;
      boardEl.dataset.scene = id;

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
      openOn(!animated);
      renderer.shadowMap.needsUpdate = true;
      needsRender = true;
    };
    swapScene.current = applyScene;

    /* ------------------------------------------------------------- props */
    const props = buildProps(savedPropsRef.current);
    scene.add(props.group);

    applyScene(firstScene.current, false);

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
    const DPR_STEPS = [1.6, 1.25, 1];
    let dprStep = 0;
    let slowFrames = 0;

    const applyDpr = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprStep]));
      renderer.setSize(container.clientWidth, container.clientHeight, false);
    };

    /** Set while the camera is in flight; see `.board-moving`. */
    let boardMoving = false;
    let stillSince = 0;

    /** How many screen pixels one board unit covers — the app's "zoom". */
    let shownZoom = 0;
    /* The readout is a React render, and a React render is the whole subtree.
       It does not need to happen sixty times a second to read as live. */
    let labelAt = 0;
    const measureZoom = () => {
      const a = boardToWorld(0, BOARD_H / 2).project(camera);
      const b = boardToWorld(BOARD_W, BOARD_H / 2).project(camera);
      return (Math.abs(b.x - a.x) * container.clientWidth) / 2 / BOARD_W;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const moving = orbit.update(camera, dt);
      if (moving) {
        needsRender = true;
        stillSince = now;
        if (!boardMoving) {
          boardMoving = true;
          boardEl.classList.add('board-moving');
        }
        // only a sustained struggle counts, so one hitch never costs a step
        if (dt > 0.028) slowFrames++;
        else slowFrames = Math.max(0, slowFrames - 1);
        if (slowFrames > 24 && dprStep < DPR_STEPS.length - 1) {
          dprStep++;
          applyDpr();
          slowFrames = 0;
        }
      } else if (boardMoving && now - stillSince > 140) {
        // Handled before the early-out below, because when the camera is at
        // rest there is no frame to hang it off.
        boardMoving = false;
        boardEl.classList.remove('board-moving');
      }
      if (!needsRender) return;
      needsRender = false;

      renderer.render(scene, camera);
      css.render(cssScene, camera);
      // it starts hidden so it can't flash at the top-left corner for a frame
      if (boardEl.style.visibility !== 'visible') boardEl.style.visibility = 'visible';

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
      camera.updateProjectionMatrix();
      applyDpr();
      css.setSize(w, h);
      // Rotating a phone changes what the room can even fit; until the reader
      // has moved the camera themselves, re-frame rather than crop.
      if (!touched) openOn(true);
      else {
        const f = active.framing(camera.aspect);
        camera.fov = f.fov;
        camera.updateProjectionMatrix();
      }
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

    const down = (e: React.PointerEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-board-chrome]') || el.closest('[data-memory-id]')) return;

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
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const prop = e.shiftKey || e.button === 1 ? null : propAt(e.clientX, e.clientY);
      if (prop) {
        mode = 'prop';
        dragged = prop;
        const p = onPlane(deskPlane);
        grabOffset = p ? prop.group.position.clone().sub(p) : new THREE.Vector3();
        setGrabbing(true);
        return;
      }
      mode = e.shiftKey || e.button === 1 ? 'pan' : 'orbit';
      setGrabbing(true);
    };

    const move = (e: React.PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (mode === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        touched = true;
        orbit.dolly(d / pinchDist);
        pinchDist = d;
        return;
      }
      if (mode === 'none') return;

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
        renderer.shadowMap.needsUpdate = true;
        needsRender = true;
      }
    };

    const up = (e: React.PointerEvent) => {
      pointers.delete(e.pointerId);
      if (mode === 'prop' && dragged) {
        placeProp(dragged.def.id, {
          x: Math.round(dragged.group.position.x),
          z: Math.round(dragged.group.position.z),
          rotation: Number(dragged.group.rotation.y.toFixed(3)),
        });
      }
      if (mode !== 'none' && !moved && !(e.target as HTMLElement).closest('[data-memory-id]')) {
        select(null);
      }
      mode = 'none';
      dragged = null;
      setGrabbing(false);
    };

    /** Double-click anything to fly to it — the room's "zoom into items". */
    const dbl = (e: React.MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-board-chrome]')) return;
      const prop = propAt(e.clientX, e.clientY);
      if (prop) {
        touched = true;
        orbit.focus(new THREE.Box3().setFromObject(prop.group), camera, 2.1);
        return;
      }
      setPointer(e.clientX, e.clientY);
      const p = onPlane(boardPlane);
      const b = active.board;
      if (p && Math.abs(p.x - b.centreX) < BOARD_W / 2 && Math.abs(p.y - b.centreY) < BOARD_H / 2) {
        touched = true;
        orbit.focus(
          new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(b.centreX, b.centreY, b.z),
            new THREE.Vector3(BOARD_W, BOARD_H, 100),
          ),
          camera,
          1.18,
        );
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      touched = true;
      if (e.shiftKey) orbit.pan(-e.deltaY, 0, camera, container.clientHeight);
      else orbit.dolly(Math.exp(-e.deltaY * 0.0016));
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
        touched = false;
        openOn(false);
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
      handlers.current = null;
      api.current = null;
      swapScene.current = null;
      pmrem.dispose();
      if (room) disposeScene(room);
      disposeScene(props.group, false);
      renderer.dispose();
      renderer.domElement.remove();
      // hand the board back so React still owns a node that is in the document
      if (boardEl.parentElement) container.appendChild(boardEl);
      css.domElement.remove();
    };
    // Built once. Memories, props, the room and the callbacks are all reached
    // through refs, so nothing here rebuilds a renderer to add a photograph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, boardRef, placeProp, select]);

  /* Changing room swaps the group under the same camera and renderer. */
  useEffect(() => {
    swapScene.current?.(sceneId, true);
  }, [sceneId]);

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

  return {
    zoomLabel,
    grabbing,
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
  };
}
