/**
 * Cork. — domain model
 *
 * Everything the board renders is a `Memory`: photos, photobooth strips,
 * tickets, postcards, notes and little labels all share one shape so they can
 * be dragged, pinned and arranged with the same code.
 */

export type MemoryType =
  | 'photo'
  | 'strip'
  | 'ticket'
  | 'postcard'
  | 'note'
  | 'sticky'
  | 'label'
  | 'memorabilia';

export type FrameStyle =
  | 'polaroid' // white border, deep chin for a caption
  | 'print' // classic white photo print
  | 'vintage' // warm film print with rounded white edge
  | 'modern' // soft rounded, borderless
  | 'noir' // thin black minimalist frame
  | 'scrapbook' // torn paper mount
  | 'strip'; // photobooth strip

export type PinStyle =
  | 'red'
  | 'blue'
  | 'yellow'
  | 'white'
  | 'metal'
  | 'pastel'
  | 'glass'
  | 'tape'
  | 'none';

export type StickyColor = 'butter' | 'blush' | 'sage' | 'dust' | 'paper';

export interface Memory {
  id: string;
  boardId: string;
  type: MemoryType;

  /** Key into the asset store (uploads). Resolved to an object URL at runtime. */
  assetId?: string;
  /** Direct URL — used by the generated demo content. */
  imageUrl?: string;

  title: string;
  caption: string;
  /** ISO date (yyyy-mm-dd) — the day the memory happened, not when it was added. */
  date: string;
  location: string;
  tags: string[];

  /** Body copy for notes, tickets and labels. */
  text?: string;
  color?: StickyColor;

  frameStyle: FrameStyle;
  pinStyle: PinStyle;

  /** Board-space position of the item's top-left corner, in board units. */
  x: number;
  y: number;
  rotation: number;
  scale: number;
  zIndex: number;

  /** Natural size in board units at scale 1. */
  w: number;
  h: number;

  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Board {
  id: string;
  name: string;
  description: string;
  coverImage?: string;
  accent: string;
  createdAt: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PersistedState {
  version: number;
  boards: Board[];
  memories: Memory[];
  activeBoardId: string;
  viewports: Record<string, Viewport>;
}

/** Board coordinate space — a fixed, generous corkboard rather than a void. */
export const BOARD_W = 3600;
export const BOARD_H = 2400;

export const MIN_ZOOM = 0.22;
export const MAX_ZOOM = 2.6;
