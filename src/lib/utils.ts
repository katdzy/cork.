import type { Memory } from './types';

export const uid = (prefix = 'm') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A small, believable tilt — never perfectly straight, never comically crooked. */
export const jitterRotation = (spread = 3.2) => rand(-spread, spread);

/** Deterministic 0..1 noise from a string — keeps decorative details stable across renders. */
export function hashNoise(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase();
}

export function relativeDay(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Axis-aligned bounds of an item, ignoring rotation (good enough for fit-to-view). */
export function memoryBounds(m: Memory) {
  const w = m.w * m.scale;
  const h = m.h * m.scale;
  return { x: m.x, y: m.y, w, h, cx: m.x + w / 2, cy: m.y + h / 2 };
}

export function searchMatches(m: Memory, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [m.title, m.caption, m.location, m.text ?? '', m.date, ...m.tags]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/** Measure a File's natural dimensions without leaking the probe URL. */
export function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * Photobooth strips are tall, narrow prints — roughly 1:3 or taller.
 * Detecting them lets us mount them as strips automatically.
 */
export function looksLikePhotoboothStrip(width: number, height: number): boolean {
  if (!width || !height) return false;
  return height / width >= 2.35;
}

/** Sensible on-board size for an image, in board units. */
export function fitToBoard(width: number, height: number) {
  const ratio = height / width || 1;
  if (ratio >= 2.35) {
    const w = 168;
    return { w, h: Math.round(w * ratio) };
  }
  if (ratio > 1.15) {
    const h = 320;
    return { w: Math.round(h / ratio), h };
  }
  const w = ratio < 0.7 ? 380 : 320;
  return { w, h: Math.round(w * ratio) };
}

export function downscaleImage(file: File, maxEdge = 1800, quality = 0.86): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      if (scale === 1 || file.size < 400_000) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob ?? file);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}
