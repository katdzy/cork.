import { useCork } from './store';
import { storage, registerAssetUrl } from './storage';
import type { FrameStyle, Memory, MemoryType, PinStyle } from './types';
import {
  downscaleImage,
  fitToBoard,
  jitterRotation,
  looksLikePhotoboothStrip,
  rand,
  readImageSize,
  todayISO,
  uid,
} from './utils';

const FRAME_CYCLE: FrameStyle[] = ['polaroid', 'print', 'vintage', 'modern', 'polaroid', 'scrapbook', 'noir'];
const PIN_CYCLE: PinStyle[] = ['red', 'white', 'blue', 'yellow', 'metal', 'pastel', 'glass'];

/** Lay a batch out in a loose cluster around the drop point — never a grid. */
function scatter(index: number, w: number, h: number) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return {
    dx: (col - 1) * (w + 34) + rand(-16, 16),
    dy: row * (h + 42) + rand(-14, 14) - (index > 2 ? 20 : 0),
  };
}

export interface DropTarget {
  x: number;
  y: number;
}

/**
 * Turn dropped files into memories that physically land on the board, one
 * after another. Images are downscaled and stored as blobs in IndexedDB; only
 * the asset key lives in the board document.
 */
export async function addFilesToBoard(files: File[], at: DropTarget, boardId?: string) {
  const store = useCork.getState();
  const images = files.filter((f) => f.type.startsWith('image/'));
  const skipped = files.length - images.length;

  if (!images.length) {
    store.toast(skipped ? 'Only image files can be pinned' : 'Nothing to add');
    return [];
  }

  const created: Memory[] = [];

  for (let i = 0; i < images.length; i++) {
    const file = images[i];
    try {
      const [{ width, height }, blob] = await Promise.all([
        readImageSize(file),
        downscaleImage(file),
      ]);

      const assetId = uid('a');
      await storage.putAsset(assetId, blob);
      registerAssetUrl(assetId, URL.createObjectURL(blob));

      const isStrip = looksLikePhotoboothStrip(width, height);
      const { w, h } = fitToBoard(width, height);
      const { dx, dy } = scatter(i, w, h);
      const type: MemoryType = isStrip ? 'strip' : 'photo';

      // stagger so each one lands with its own little drop
      await new Promise((r) => setTimeout(r, i === 0 ? 0 : 130));

      const memory = useCork.getState().addMemory({
        type,
        assetId,
        boardId: boardId ?? useCork.getState().activeBoardId,
        title: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 60),
        date: todayISO(),
        frameStyle: isStrip ? 'strip' : FRAME_CYCLE[(i + Math.floor(rand(0, 3))) % FRAME_CYCLE.length],
        pinStyle: isStrip ? 'white' : PIN_CYCLE[i % PIN_CYCLE.length],
        x: Math.round(at.x + dx - w / 2),
        y: Math.round(at.y + dy - h / 2),
        w,
        h,
        rotation: jitterRotation(isStrip ? 2 : 3.6),
        scale: 1,
      });
      created.push(memory);
    } catch {
      useCork.getState().toast(`Couldn’t read ${file.name}`);
    }
  }

  if (created.length) {
    const label =
      created.length === 1 ? '1 memory pinned' : `${created.length} memories pinned`;
    useCork.getState().toast(skipped ? `${label} · ${skipped} file(s) skipped` : label);
  }
  return created;
}

const OBJECT_PRESETS: Record<
  'sticky' | 'note' | 'ticket' | 'label' | 'postcard',
  Partial<Memory> & { w: number; h: number }
> = {
  sticky: { w: 208, h: 208, text: 'remember this day :)', color: 'butter', pinStyle: 'none' },
  note: { w: 240, h: 124, text: 'we stayed until sunset', pinStyle: 'tape' },
  ticket: { w: 300, h: 132, text: 'CONCERT', location: 'MANILA', pinStyle: 'none' },
  label: { w: 214, h: 58, text: "SUMMER '26", pinStyle: 'none' },
  postcard: {
    w: 360,
    h: 237,
    text: 'wish you were here —\nreally.',
    pinStyle: 'red',
    caption: 'wish you were here',
  },
};

export function addPaperObject(kind: keyof typeof OBJECT_PRESETS, at: DropTarget) {
  const preset = OBJECT_PRESETS[kind];
  return useCork.getState().addMemory({
    type: kind,
    date: todayISO(),
    rotation: jitterRotation(4),
    scale: 1,
    ...preset,
    x: Math.round(at.x - preset.w / 2),
    y: Math.round(at.y - preset.h / 2),
  });
}
