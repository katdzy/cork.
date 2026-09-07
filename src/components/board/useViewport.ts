import { useCallback, useEffect, useRef, useState } from 'react';
import { BOARD_H, BOARD_W, MAX_ZOOM, MIN_ZOOM, type Memory, type Viewport } from '../../lib/types';
import { clamp, memoryBounds } from '../../lib/utils';
import { useCork } from '../../lib/store';

const EASE = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The board's camera.
 *
 * Pan and zoom are written straight to the DOM so dragging stays at 60fps —
 * React only hears about the zoom level (for the readout) and the resting
 * position (for persistence).
 */
export function useViewport(
  boardId: string,
  containerRef: React.RefObject<HTMLDivElement>,
  worldRef: React.RefObject<HTMLDivElement>,
  memories: Memory[],
) {
  const view = useRef<Viewport>({ x: 0, y: 0, zoom: 0.8 });
  /** True once the reader has moved the camera themselves. */
  const touched = useRef(false);
  const zoomRef = useRef(0.8);
  const [zoomLabel, setZoomLabel] = useState(0.8);
  const labelRef = useRef(0.8);
  const raf = useRef(0);
  const saveTimer = useRef(0);
  const setViewport = useCork((s) => s.setViewport);
  const savedViews = useCork((s) => s.viewports);
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;

  const apply = useCallback(() => {
    const el = worldRef.current;
    if (!el) return;
    const { x, y, zoom } = view.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
    el.style.setProperty('--inv-zoom', String(1 / zoom));
    zoomRef.current = zoom;
  }, [worldRef]);

  const persist = useCallback(() => {
    touched.current = true;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setViewport(boardId, { ...view.current });
    }, 500);
  }, [boardId, setViewport]);

  /** Keep the board from being flung off into nowhere. */
  const clampView = useCallback(
    (v: Viewport): Viewport => {
      const c = containerRef.current;
      if (!c) return v;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const bw = BOARD_W * v.zoom;
      const bh = BOARD_H * v.zoom;
      const slackX = Math.min(cw * 0.45, 420);
      const slackY = Math.min(ch * 0.45, 340);

      const x = bw <= cw ? (cw - bw) / 2 : clamp(v.x, cw - bw - slackX, slackX);
      const y = bh <= ch ? (ch - bh) / 2 : clamp(v.y, ch - bh - slackY, slackY);
      return { x, y, zoom: v.zoom };
    },
    [containerRef],
  );

  const set = useCallback(
    (next: Viewport, opts?: { silent?: boolean }) => {
      view.current = clampView({ ...next, zoom: clamp(next.zoom, MIN_ZOOM, MAX_ZOOM) });
      apply();
      if (Math.abs(labelRef.current - view.current.zoom) > 0.004) {
        labelRef.current = view.current.zoom;
        setZoomLabel(view.current.zoom);
      }
      if (!opts?.silent) persist();
    },
    [apply, clampView, persist],
  );

  const animateTo = useCallback(
    (target: Viewport, duration = 420) => {
      cancelAnimationFrame(raf.current);
      const from = { ...view.current };
      const to = clampView({ ...target, zoom: clamp(target.zoom, MIN_ZOOM, MAX_ZOOM) });
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const e = EASE(p);
        view.current = {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          zoom: from.zoom + (to.zoom - from.zoom) * e,
        };
        apply();
        labelRef.current = view.current.zoom;
        setZoomLabel(view.current.zoom);
        if (p < 1) raf.current = requestAnimationFrame(step);
        else persist();
      };
      raf.current = requestAnimationFrame(step);
    },
    [apply, clampView, persist],
  );

  const zoomAt = useCallback(
    (factor: number, screenX: number, screenY: number, animated = false) => {
      const c = containerRef.current;
      if (!c) return;
      const box = c.getBoundingClientRect();
      const px = screenX - box.left;
      const py = screenY - box.top;
      const { x, y, zoom } = view.current;
      const next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const target = {
        x: px - ((px - x) / zoom) * next,
        y: py - ((py - y) / zoom) * next,
        zoom: next,
      };
      if (animated) animateTo(target, 260);
      else set(target);
    },
    [animateTo, containerRef, set],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const c = containerRef.current;
      if (!c) return;
      const box = c.getBoundingClientRect();
      zoomAt(factor, box.left + box.width / 2, box.top + box.height / 2, true);
    },
    [containerRef, zoomAt],
  );

  /** Frame everything on the board (or the whole board when it's empty). */
  const computeFit = useCallback(
    (items: Memory[], maxZoom = 1): Viewport => {
      const c = containerRef.current;
      if (!c) return view.current;
      const cw = c.clientWidth;
      const ch = c.clientHeight;

      // keep the composition clear of the floating chrome
      const wide = cw >= 900;
      const inset = wide
        ? { left: 268, right: 92, top: 84, bottom: 84 }
        : { left: 26, right: 26, top: 82, bottom: 104 };
      const availW = Math.max(240, cw - inset.left - inset.right);
      const availH = Math.max(200, ch - inset.top - inset.bottom);

      // an empty board frames the empty-state arrangement, not the whole sheet
      let box = {
        minX: BOARD_W / 2 - 570,
        maxX: BOARD_W / 2 + 570,
        minY: BOARD_H / 2 - 330,
        maxY: BOARD_H / 2 + 330,
      };
      if (items.length) {
        box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const m of items) {
          const b = memoryBounds(m);
          box.minX = Math.min(box.minX, b.x);
          box.minY = Math.min(box.minY, b.y);
          box.maxX = Math.max(box.maxX, b.x + b.w);
          box.maxY = Math.max(box.maxY, b.y + b.h);
        }
      }

      const w = Math.max(320, box.maxX - box.minX);
      const h = Math.max(240, box.maxY - box.minY);

      if (!wide) {
        // A phone shouldn't shrink a wall-sized arrangement to fit — show a
        // comfortable slice of it, anchored at the top, and let it be panned.
        const zoom = clamp(availW / Math.min(w, 620), 0.5, maxZoom);
        return {
          zoom,
          x: cw / 2 - (box.minX + w / 2) * zoom,
          y: inset.top - box.minY * zoom + 16,
        };
      }

      const zoom = clamp(Math.min(availW / w, availH / h), MIN_ZOOM, maxZoom);
      return {
        zoom,
        x: inset.left + availW / 2 - (box.minX + w / 2) * zoom,
        y: inset.top + availH / 2 - (box.minY + h / 2) * zoom,
      };
    },
    [containerRef],
  );

  const fitAll = useCallback(() => {
    animateTo(computeFit(memoriesRef.current), 520);
  }, [animateTo, computeFit]);

  const resetView = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const zoom = 0.8;
    animateTo({
      zoom,
      x: c.clientWidth / 2 - (BOARD_W / 2) * zoom,
      y: c.clientHeight / 2 - (BOARD_H / 2) * zoom,
    });
  }, [animateTo, containerRef]);

  /** Centre a single memory — used when jumping to a search result. */
  const focusOn = useCallback(
    (m: Memory, zoom = 1) => {
      const c = containerRef.current;
      if (!c) return;
      const b = memoryBounds(m);
      animateTo({ zoom, x: c.clientWidth / 2 - b.cx * zoom, y: c.clientHeight / 2 - b.cy * zoom }, 560);
    },
    [animateTo, containerRef],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const { x, y, zoom } = view.current;
      set({ x: x + dx, y: y + dy, zoom });
    },
    [set],
  );

  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const c = containerRef.current;
      if (!c) return { x: 0, y: 0 };
      const box = c.getBoundingClientRect();
      const { x, y, zoom } = view.current;
      return { x: (clientX - box.left - x) / zoom, y: (clientY - box.top - y) / zoom };
    },
    [containerRef],
  );

  /* restore the saved camera when the board changes ---------------------- */
  const restoredFor = useRef<string>('');
  const hasSavedView = Boolean(savedViews[boardId]);

  useEffect(() => {
    if (!boardId || restoredFor.current === boardId) return;
    if (!containerRef.current?.clientWidth) return;
    restoredFor.current = boardId;
    touched.current = hasSavedView;
    const next = savedViews[boardId] ?? computeFit(memoriesRef.current);
    view.current = clampView(next);
    apply();
    labelRef.current = view.current.zoom;
    setZoomLabel(view.current.zoom);
  }, [boardId, savedViews, hasSavedView, computeFit, clampView, apply, containerRef]);

  /**
   * Until someone moves the camera themselves, keep the board framed —
   * the container can still be settling on the first frames after mount.
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!el.clientWidth) return;
      if (touched.current) {
        view.current = clampView(view.current);
        apply();
      } else {
        view.current = clampView(computeFit(memoriesRef.current));
        apply();
        labelRef.current = view.current.zoom;
        setZoomLabel(view.current.zoom);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply, clampView, computeFit, containerRef]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return {
    view,
    zoomRef,
    zoomLabel,
    set,
    panBy,
    zoomAt,
    zoomBy,
    fitAll,
    resetView,
    focusOn,
    toBoard,
    apply,
  };
}
