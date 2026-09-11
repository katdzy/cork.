# Cork.

**Keep your memories close.**

A digital corkboard, hanging in a room you can walk around. Photos, photobooth
strips, tickets, postcards and handwritten notes get pinned to a cork surface
you can drag, rotate and resize; the board itself hangs over a desk you can
rearrange, in either of two rooms — a cream kitchen-office lit by one big
window, or a concrete studio some way up an office building, with a glazed
curtain wall down one side and a doorway onto the rest of the floor.
Swing the camera, move in on anything, and it looks exactly as you left it when
you come back. When you would rather arrange the board than admire it, the
camera goes square on to it and flat, so nothing on the way to a photograph can
knock the room off its axis — and anything you have finished placing can be
locked where it is. The light in both rooms is ray traced — once, before the
first frame — and both of them scale themselves down to whatever they are being
drawn on.

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
    layout.ts         the skeleton both rooms share — walls, desk, camera leashes
    themes.ts         the two rooms: framing, exposure, where the board hangs
    quality.ts        three tiers, and which machine gets which
    trace.ts          the ray tracer: triangles in, shaded vertices out
    trace.worker.ts   the same, on a thread that is allowed to be busy
    bake.ts           what to trace, where to put it, and the mesh merge
    probe.ts          each room captured into a cubemap, for reflections
    textures.ts       oak, plaster, concrete, glass, metal, weave, paper
    parts.ts          boxes, foliage cards, the fake bloom and the light shafts
    buildRoom.ts      kitchen shell: walls, floor, window, counter, cabinets
    buildFittings.ts  kitchen: mail rack, hook rail, basket, the board's frame
    buildStudio.ts    studio: concrete, glazing, doorway, pendants, desk, chair
    props.ts          the things on the desk, and where they start
    orbit.ts          the camera: on a leash in the room, square on at the board
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

Writes are debounced. Moving, rotating, resizing, re-framing, re-pinning and
holding a memory in place all persist, and so does wherever you leave the
laptop on the counter. Which of the two ways of looking you are using does
not: it describes what you are doing at this moment, not what the board is.

The first read is bounded, because a failed IndexedDB request rejects and a
*blocked* one does neither — an upgrade behind another tab's connection, a
deletion that never completed, and the request waits along with everything
queued behind it. Nothing to catch, and since the board cannot be drawn until
it is known what is on it, the app would sit on its splash screen for ever.
Two seconds is not a deadline for a local read of one document, it is a
diagnosis: past it the demo board opens instead, and nothing is written for
the rest of the session, because a seed board saved over a real one is the
only failure here that cannot be undone.

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

### Two ways of looking

Arranging a board and looking around a room are opposite jobs, and a camera
good at the second is actively bad at the first. Free orbit carries three axes
into a gesture that only wanted two: reach for a photograph, miss it by four
pixels, and the room swings instead — the photograph is somewhere else now, at
a slightly different angle, and the drag that was going to move it has to be
started again from a view nobody asked for.

So there are two. The room is the camera on its leash, free to swing. The cork
view drops the azimuth to zero and the polar angle to a right angle and holds
them there: square on to the board, two degrees of freedom, slide and zoom.
Rotation is not damped or narrowed or snapped back — `rotate` returns without
doing anything, because an axis that cannot be reached by accident is the only
kind that is genuinely safe. The room's furniture stops being pickable for the
same reason: a drag aimed at the board that lands four pixels beside it should
do nothing you have to undo.

Two things follow from being square on. Screen space and board space become the
same space up to a scale, so a photograph dragged across the cork tracks the
pointer exactly rather than sliding along a foreshortened plane, and the wheel
can hold the thing under the cursor still while it zooms — one line, because a
point keeps its place on screen when the target closes on it in the same
proportion the camera does. That line is solved against the pose being chased
rather than the camera's current one: a wheel throws a dozen events before the
first has finished animating, and anchoring each to a different frame of the
flight walks the cursor off the thing it was on.

The other is that the frame can be kept full of cork. How far the middle of the
view may stray from the middle of the board is the board's half-extent less
half of what the lens takes in — so the further in you are the further you may
slide, and the moment the board stops filling the frame on an axis the
allowance on that axis goes to nothing and the view centres itself. No rubber
band, no dead scroll off the edge into plaster: the limit moves with the zoom.

What it frames into is not the window but the part of the window you can see.
There is a sidebar over one end of it, and in the room that only shifts the
composition — on a board you are arranging it hides the things you were going
to arrange. One number, how much of the width is behind chrome, moves the
framing, the fit and the pan limits together.

The one place *fit the board* is the wrong rule is a phone held upright. The
board is half again as wide as it is tall and the screen is twice as tall as it
is wide, so fitting its width puts the camera far enough back that the board
covers under a third of the height and everything pinned to it is four
millimetres across — a view of a board rather than a view for working on one,
and barely closer than the room it was entered from. So the pullback stops
where the board still fills most of the frame and the rest is left to the pan.
On anything wider than about four to three the whole board fits inside that
anyway and the cap never binds.

Leaving puts the room back exactly as it was left, angle included, because the
pose is parked on the way in rather than recomputed on the way out.

One thing the two views share is that neither of them may be scrolled. The
board is three and a half thousand pixels wide and routinely overflows the
element it hangs in, and every memory on it is focusable — which is all it
takes for a browser to scroll an `overflow: hidden` container to bring a
clicked photograph into view, sliding the WebGL canvas, the chrome and the DOM
board with it while the camera that drew the scene knows nothing about it. The
fix is one word: `overflow: clip` clips without ever becoming scrollable.

### Held in place

A board you have finished arranging is mostly a board you want to stop
arranging. The reason to reach for a pinned photograph is usually to look at
it, and every one of those reaches is four pixels of pointer travel away from
moving it instead. So a memory can be locked, and what the lock holds is
position, angle and size — by drag, by handle, by arrow key, and by the angle
slider in its own card, since that is the same change made deliberately. It
holds nothing else: a locked memory still selects, opens, edits and
favourites. It is an anchor, not a read-only flag.

It also catches the delete key, which is the accident actually worth catching,
and offers the way out in the same breath rather than an undo afterwards.

A lock that does nothing visible is a lock nobody trusts. Nothing happening is
ambiguous — a dropped gesture, a slow frame, the wrong element under the
pointer — so a locked thing gives a degree and a half when you push it and
comes straight back, which is unambiguous in the time it takes to notice. Its
outline goes from marching ants to an unbroken line, and the corner where the
rotate handle would have been carries a padlock instead: the corner you reach
for to move it is the corner that tells you it won't.

### The light, traced

Everything a rasteriser is bad at is everything a room is made of. The
darkening where two walls meet, the shadow a counter sits in that no lamp
actually casts, the warmth an oak floor throws up onto the underside of the
worktop above it — a shadow map has nothing to say about any of them. They are
all visibility questions, and the way to answer a visibility question is to
fire a ray and find out.

So both rooms are ray traced. Their triangles go into a BVH, every vertex fires
a few dozen cosine-weighted rays over its hemisphere, and two things come back:
how many were blocked, and what colour the blockers were. The first is
occlusion, the second is one bounce of colour bleed, and both are folded into
the vertex colour attribute that the standard material already multiplies into
its diffuse term for nothing. Two ranges are read off the same hit — forty
centimetres for contact, a metre and a half for enclosure — which is what gives
shadows that harden as they approach the thing casting them.

It is real tracing and the results are a path tracer's at one bounce. It also
happens once, for a room that never moves, and costs nothing per frame
afterwards. The alternative, SSAO, is a depth pass and a blur on *every* frame
to approximate at half resolution what is sitting in a buffer here already —
and it cannot do the colour bleed at all.

The room range is the number the whole thing turns on. Set it to the size of
the room and every surface in the room is occluded by the room: the average
comes out dark, the corners are no darker *relative to* the walls than they
were, and what was meant to be shading reads as somebody having turned the
lights down.

Reflections are the other half. Screen-space reflections can only show what is
already on screen, which is why they tear at the edges of the frame; real ones
mean a second ray per pixel per frame. Both answer, every frame, a question
whose answer for a static room is a constant — so each room is captured into a
small cubemap from a point inside it and prefiltered into the roughness pyramid
a physically based material samples. Every mullion, cup pull, laptop lid and
pane of glass then reflects the actual room, the actual window, the actual
city. The lie is the single capture point, and it is a far smaller error than
reflecting a generic grey box, which is what was there before.

Glass needs two draws, because one material cannot be both. A transparent
material scales everything it produces by its opacity, reflection included, so
a pane faint enough to see the city through has no reflection in it. A nearly
clear tint carries the body of the pane; over it, a black fully metallic sheet
blended additively contributes nothing but the environment term. The honest fix
is `transmission`, which renders the scene to a second buffer so the glass can
refract it — one more full pass, every frame, for a window.

Light shafts and the patches where they land are cards, for the same reason the
bloom is: a volumetric means marching the depth buffer toward the sun and
sampling the shadow map at every step, once per pixel per frame, to draw
something whose position, direction and length are all constants. They are kept
short and faint — a card cut off by the depth test looks exactly like a card,
so the defence is to put them where there is no wall.

None of this blocks the first frame. The trace runs in a worker (`trace.ts`
imports nothing, so what gets bundled to run there is four kilobytes of
arithmetic rather than a second copy of three.js); the room draws unshaded
immediately and takes its light a moment later. A third of a second of tracing
is cheap for something paid once; a third of a second during which nothing on
the page can move is a freeze, and on a phone it would be closer to two.

### What it costs, and what gets cut

Every expensive number in the scene — shadow map sizes, texture sizes, how many
rays the bake fires, whether there are light shafts at all — comes from one of
three tiers in `quality.ts`, resolved once at load and never consulted again.
There is no per-frame branch on quality anywhere, because a room drawn on
demand cannot afford to decide anything sixty times a second.

The tier is guessed from cores, reported memory, and the GPU's own renderer
string, read from a throwaway WebGL context opened before the real one — by the
time there is something to measure, `antialias` and `powerPreference` are
already fixed for the life of the context. Guessing is what it is, so
**Settings → Graphics** overrides it; a phone that turns out to be fast is one
tap from High and a throttled laptop one tap from Low.

| | low | medium | high |
| --- | --- | --- | --- |
| multisampling | off | on | on |
| drawing buffer | ≤ 1.15 Mpx | ≤ 1.9 Mpx | ≤ 2.6 Mpx |
| sun shadow map | 1024 | 1280 | 2048 |
| pendant shadows | off | on | on |
| textures | quarter size¹ | half size | full size |
| roughness maps | off | on | on |
| rays for the bake | 30k | 72k | 150k |
| reflection probe | 64, one pass | 96, one pass | 160, two passes |
| light shafts | off | on | on |

¹ except the cork, which drops one step at most wherever the tier stands. It
is the surface the app is named after and it is read from a hand's breadth
away; saving a megabyte on it saves the megabyte and loses the app.

Two ceilings on resolution, because a ratio alone is not a budget: device pixel
ratio says how dense the panel is, not how many pixels there are — a phone at
ratio three is a million of them and a 4K display at ratio one is eight
million. The cost of this scene is almost entirely the second number, so that
is what gets capped and the ratio is whatever fits underneath.

The other half of the work is draw calls. A room of a hundred and fifty boxes
is a hundred and fifty of them, and then a hundred and fifty more for every
shadow-casting light that looks at it. Nothing in a room moves, so once the
light has been traced in, every mesh sharing a material is folded into one:
ninety-four meshes down to twenty-six in the kitchen, eighty-four to
twenty-four in the studio, and each prop separately on top of that. Which is
also why every material in a room is hoisted out of the loop that uses it —
five identical brass pulls built from five identical materials are five draws
the merge cannot fold, because what it batches by is material identity. It is safe precisely because
nothing in a room is ever picked: raycasting only runs against the props, and
those are merged one prop at a time so each stays a thing you can grab.

Props cannot take the room's bake, because a prop is the one thing here that
moves and occlusion baked from its surroundings would be a lie the moment it
was put down somewhere else. What is true wherever it stands is its own shape —
the crease under a mug's handle, the dark inside a crate — plus an implicit
floor at its feet, since the only place a prop is ever put down is on one.

Both rooms are built once and kept. Swapping used to dispose one and build the
other from nothing, which was affordable when a room was a hundred boxes and is
not now that it is a hundred boxes plus a ray trace and a cubemap capture.

### Textures

The cork is a generated SVG of a few hundred rotated granule ellipses, tiled at
two unrelated sizes with mottling and old pin holes over it — the whole surface
is one element with one background stack. Board-sized layers using
`mix-blend-mode` looked the same and cost a full repaint on every moved frame.

Everything in the room is drawn once into a canvas and uploaded as a tiling
texture: oak grain as long cathedral arcs with open pores, limewash as three
scales of noise, seagrass as an over-under weave, brushed steel as four
thousand scratches along one axis, each differenced into a normal map. Baking
beats evaluating — an earlier room computed its plaster and its oak per pixel
per frame, which made the cost scale with the screen and charged it again every
frame for a wall that never changes.

Roughness maps are height fields squeezed into the band the material actually
lives in. Handing a height field straight to `roughnessMap` says the dark grain
of a board is a perfect mirror and the light grain is chalk; real oak is 0.3 to
0.55 everywhere and concrete never leaves the top quarter. Getting that band
right is most of the difference between a surface that catches the window the
way the material would and one that looks sprayed with varnish — and it matters
far more now that what it is catching is a capture of the room rather than a
grey studio.

Metal and glass are drawn dirty on purpose. A polished mullion reflects the
probe's own viewpoint, which is right from exactly one place in the room and
visibly painted on from every other; brushing it smears that reflection along
the direction of the brushing, which is both what the real thing does and what
stops a single capture being caught out. The glazing gets the arcs a cloth
leaves, grime where the frame holds the pane, and whatever the last storm left
running down it.

## Interactions

| | |
| --- | --- |
| drag the room | swing the camera around it |
| the lamp / sun button | move the board to the other room |
| drag an item | move it; it lifts, then settles with a small angle change |
| drag something on the counter | put it down somewhere else; it stays there |
| double-click a prop | move in on it |
| double-click the cork | go square on to it, and stay there — the cork view |
| the board button | the cork view, and back out of it |
| in the cork view | drag slides, scroll and pinch zoom about the pointer, nothing rotates |
| `esc` | back to the room, exactly as you left it |
| click an item | open it, expanding from where it sits on the board |
| after a drag | handles appear — corner to resize, top corner to rotate |
| `L` | hold a selected item where it is, or let it go again |
| arrow keys | nudge a selected item (hold shift for bigger steps) |
| `[` / `]` | rotate a selected item |
| `delete` | remove it, with undo — a held item says so instead |
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
- Graphics quality is per device, in `localStorage` rather than in the board
  document — it describes the machine, not the board, and should not follow a
  board to another one.
- Uploads are downscaled to 1800px on the long edge before being stored.
