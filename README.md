# Cork.

**Keep your memories close.**

A digital corkboard, hanging in a room you can walk around. Photos, photobooth
strips, tickets, postcards and handwritten notes get pinned to a cork surface
you can drag, rotate and resize; the board itself hangs over a desk you can
rearrange, in either of two rooms — a cream kitchen-office lit by one big
window, or a concrete studio some way up an office building, with a glazed
curtain wall down one side and a doorway onto the rest of the floor.
Swing the camera, move in on anything, and it looks exactly as you left it when
you come back.

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
    types.ts          Memory / Board model, board dimensions
    store.ts          Zustand store — boards, memories, props, selection, toasts
    storage.ts        CorkStorage interface + the IndexedDB implementation
    createMemories.ts uploads and paper objects → memories on the board
    seed.ts           the demo board
    art.ts            the demo photographs, drawn as SVG
    corkTexture.ts    the cork surface, generated as tiling SVG
  scene/
    layout.ts         the skeleton both rooms share — walls, desk, camera leash
    themes.ts         the two rooms: framing, exposure, where the board hangs
    textures.ts       oak, plaster, concrete, weave, fabric and paper, baked
    parts.ts          boxes, foliage cards, and the fake bloom
    buildRoom.ts      kitchen shell: walls, floor, window, counter, cabinets
    buildFittings.ts  kitchen: mail rack, hook rail, basket, the board's frame
    buildStudio.ts    studio: concrete, glazing, doorway, pendants, desk, chair
    props.ts          the things on the desk, and where they start
    orbit.ts          the camera, on a leash
    useRoomScene.ts   the two renderers, the loop, and every gesture
  components/
    board/            canvas, cork surface, items, pins, empty state
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

Writes are debounced. Moving, rotating, resizing, re-framing and re-pinning a
memory all persist, and so does wherever you leave the laptop on the counter.

### The rooms

There are two, and only the room changes: the renderer, the camera, the board
and everything you have put on the desk outlive the switch, so moving from the
kitchen to the studio is a change of place rather than a reload. What differs
lives in `themes.ts` — where the board hangs, how the camera opens on it, how
bright the room is, and what gets built into it.

In the studio the curtain wall is the key light and the mullions are real
geometry, so the bars of shadow they lay across the floor and the desk are
real too — which is most of what makes a window read as a window rather than
as a bright rectangle. The pendants stay lit over the top of it, because an
office at that hour has both.

The studio's bloom is faked. A real bloom pass means rendering to a target,
extracting the bright parts, blurring them across several half-size buffers and
compositing back — five or six full-screen passes, for an effect that only ever
happens around two bulbs whose positions are known. Additive billboards at
those positions cost two draws and no passes, and because they sit outside tone
mapping they keep the hot centre a real bloom would flatten.

### The board in the room

Two renderers over one camera. three.js draws the room into a WebGL canvas;
a `CSS3DRenderer` layer puts the corkboard — real DOM, with every memory still
a live element you can drag, open and type into — onto the plane where it
hangs. Photographs stay as sharp as the display can show and text stays
selectable, and none of that stops being true when the camera swings.

Everything draws on demand. The room is static, so once the camera settles the
loop does nothing: no redraw, no shadow pass, no GPU work. The sun's shadow map
is rendered once and kept, and re-rendered only while a prop is being dragged.
During a gesture the pixel ratio drops to 1 and climbs back a fifth of a second
after you let go — pixels are the whole cost of the scene, and they scale with
the square of that number.

### Textures

The cork is a generated SVG of a few hundred rotated granule ellipses, tiled at
two unrelated sizes with mottling and old pin holes over it — the whole surface
is one element with one background stack. Board-sized layers using
`mix-blend-mode` looked the same and cost a full repaint on every moved frame.

Everything in the room is drawn once into a canvas and uploaded as a tiling
texture: oak grain as long cathedral arcs with open pores, limewash as three
scales of noise, seagrass as an over-under weave, each differenced into a
normal map. Baking beats evaluating — an earlier room computed its plaster and
its oak per pixel per frame, which made the cost scale with the screen and
charged it again every frame for a wall that never changes.

## Interactions

| | |
| --- | --- |
| drag the room | swing the camera around it |
| the lamp / sun button | move the board to the other room |
| drag an item | move it; it lifts, then settles with a small angle change |
| drag something on the counter | put it down somewhere else; it stays there |
| double-click anything | move in on it — a prop, or the board |
| click an item | open it, expanding from where it sits on the board |
| after a drag | handles appear — corner to resize, top corner to rotate |
| arrow keys | nudge a selected item (hold shift for bigger steps) |
| `[` / `]` | rotate a selected item |
| `delete` | remove it, with undo |
| scroll or pinch | move in and out · `shift` scroll to slide sideways |
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
