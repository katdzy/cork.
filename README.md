# Cork.

**Keep your memories close.**

A digital corkboard. Photos, photobooth strips, tickets, postcards and
handwritten notes get pinned to a cork surface you can drag, rotate, resize,
zoom and pan — and it looks exactly as you left it when you come back.

```bash
npm install
npm run dev
```

| script | what it does |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | typecheck + production bundle into `dist/` |
| `npm run preview` | serve the production build |
| `npm run typecheck` | types only |

## Hosting

It's a static build with no backend, so `dist/` can be dropped on anything.

**GitHub Pages** is wired up: pushing to `main` builds and publishes via
`.github/workflows/deploy.yml`. It needs enabling once — repository
**Settings → Pages → Source: GitHub Actions** — after which the site is at
`https://<user>.github.io/<repo>/`.

**Anywhere else** (Vercel, Netlify, Cloudflare Pages, any static host) needs no
configuration beyond the usual:

| | |
| --- | --- |
| build command | `npm run build` |
| output directory | `dist` |

`base` is `'./'`, so assets are referenced relatively and the same build works
at a domain root or under a project subpath. There is no client-side routing,
so no SPA rewrite rule is needed either.

Note the app keeps everything in the visitor's own browser (IndexedDB). Hosting
it publishes the app, not your board — every visitor gets their own, starting
from the demo.

## How it fits together

```
src/
  lib/
    types.ts          Memory / Board model, board dimensions, zoom limits
    store.ts          Zustand store — boards, memories, selection, toasts
    storage.ts        CorkStorage interface + the IndexedDB implementation
    createMemories.ts uploads and paper objects → memories on the board
    seed.ts           the demo board
    art.ts            the demo photographs, drawn as SVG
    corkTexture.ts    the cork surface, generated as tiling SVG
  components/
    board/            canvas, camera, surface, items, pins, empty state
    frames/           the seven photo treatments
    objects/          sticky notes, notes, tickets, labels, postcards
    chrome/           sidebar, mobile bar, search, add menu, results shelf
    modals/           memory detail, settings
```

### Persistence

Everything goes through `CorkStorage` (`src/lib/storage.ts`). Board documents
live in one IndexedDB database, uploaded image blobs in another, keyed by
`assetId`; the board document only ever stores the key, and blobs become object
URLs on demand. Swapping in a backend means writing a second implementation of
that interface — nothing in the UI or the store changes.

Writes are debounced. Moving, rotating, resizing, re-framing, re-pinning and
camera position all persist per board.

### The camera

`useViewport` owns pan and zoom. It writes transforms straight to the DOM
rather than through React, so dragging the board never re-renders the items on
it; React only hears about the zoom readout and the resting position. Items
counter-scale their handles through the `--inv-zoom` and `--inv-item` custom
properties so controls keep a constant on-screen size at any zoom.

### Textures

The cork is a generated SVG of a few hundred rotated granule ellipses, tiled at
two unrelated sizes with mottling and old pin holes over it — the whole surface
is one element with one background stack. Board-sized layers using
`mix-blend-mode` looked the same and cost a full repaint on every panned frame.

## Interactions

| | |
| --- | --- |
| drag an item | move it; it lifts, then settles with a small angle change |
| click an item | open it, expanding from where it sits on the board |
| after a drag | handles appear — corner to resize, top corner to rotate |
| arrow keys | nudge a selected item (hold shift for bigger steps) |
| `[` / `]` | rotate a selected item |
| `delete` | remove it, with undo |
| scroll / drag the board | pan · `⌘`/`ctrl` scroll or pinch to zoom |
| `/` or `⌘K` | search captions, titles, tags, places and dates |
| drop files anywhere | they land on the board one by one, pinned |
| paste an image | same, at the centre of the view |

Tall narrow images (roughly 1:2.35 or taller) are recognised as photobooth
strips and mounted as strips.

## Notes

- No backend, no network calls. The demo photographs are drawn in code, so a
  fresh install looks like a real board offline.
- Motion honours `prefers-reduced-motion` via `MotionConfig reducedMotion="user"`.
- Uploads are downscaled to 1800px on the long edge before being stored.
