# Inkflow

A handwriting canvas for iPad Safari that tries to feel like Notability, built
so the individual parts of the ink pipeline can be switched on and off while you
write. One `index.html`, no build step, no dependencies, nothing uploaded.

Add it to the home screen and it runs offline.

## What Notability actually does

Public detail on the ink engine is thin, so this separates what is documented
from what is guessed.

**Established:**

- Every stroke is stored as **Bézier curves**, not pixels, which is why ink stays
  crisp at any zoom and can be recoloured and resized after it is drawn.
- The rendering engine was **rewritten in Metal**.
- The plain pen keeps **one constant width**. Reviewers comparing it with
  GoodNotes note that it does not vary with writing speed and that letter ends
  are **not tapered**. Pressure is a separate per-pen toggle, marked `~`.
- Ginger Labs describe the engine as tracking the Pencil's position **as closely
  as possible**, and only offer a Stabilization setting on the calligraphy pen.
  So the smoothing is light by design.
- Holding still at the end of a stroke straightens it; holding after a closed
  shape snaps the shape.
- One measurement puts it at roughly 13 ms of latency, against 11 ms for
  GoodNotes and 9 ms for Apple Notes.

**Not established:** the exact spline fitting, the pressure curve, and the cap
shape. Those are reconstructed here from open-source ink engines instead, mainly
perfect-freehand, tldraw and the 1 euro filter paper.

## The pipeline

1. **Capture.** Pointer events with `touch-action: none`, reading
   `getCoalescedEvents()` so all 240 Pencil samples a second are used rather
   than one per frame. Once a pen is seen, fingers are ignored.
2. **Filter.** A light streamline lerp by default, or a 1 euro filter, both on
   position only. Movement under a threshold is discarded as jitter.
3. **Curve.** Centripetal Catmull-Rom, alpha 0.5, resampled to a vertex every
   1.4 px. The centripetal form is what stops loops and overshoot on unevenly
   spaced samples.
4. **Width.** Constant, or from pressure, or from speed, or both. Pencil force
   is lifted by 1.25, eased, and smoothed by distance travelled rather than by
   time, so a resting pen cannot make the line drift thicker. The first sample's
   force is discarded because it is unreliable.
5. **Geometry.** The centreline is offset by half the width on each side and the
   ring is filled, so the edge is one anti-aliased boundary rather than a stack
   of overlapping round segments. A disc fills the notch at hard corners.
6. **Two layers.** Settled geometry is committed to a canvas that is never
   cleared. Only a short live tail is redrawn per event, so the cost of an event
   does not grow with the length of the stroke.
7. **Pixel mapping.** The backing store is sized from the element's fractional
   `getBoundingClientRect()` rather than the rounded `clientWidth`, and the
   canvas is then given that exact size in CSS pixels. One canvas pixel is one
   device pixel, so nothing is resampled on the way to the screen. Verified: a
   one-device-pixel line renders as a single opaque column with no bleed into
   its neighbours.

The pixel ratio defaults to the full ratio the device reports, up to 3. It was
capped at 2, which cost a third of the linear resolution on any 3x screen. The
only limit now is a 12 megapixel guard per canvas, since there are two of them
and iOS runs out of memory well before WebKit's own 8192x8192 ceiling.

Edge softness measured on a diagonal stroke, in CSS pixels of partial coverage
per solid pixel: 1.49 at ratio 1, 0.90 at ratio 1.25, and proportionally
sharper above that. Per-event cost stays under 2.4 ms worst case against a
16.7 ms frame, so the extra resolution is not paid for in latency.

## Why it does not lag

Three things, all switchable so you can feel each one:

- **The tip follows the pen.** The drawn tail ends at the raw reported pointer
  position, not at the filtered curve. The smoothing catches up behind it. This
  alone removes the filter's lag from what you see.
- **Prediction.** A short tail is drawn ahead of the pen, from
  `getPredictedEvents()` where Safari provides it and by extrapolation
  otherwise. It lives only on the live layer and is thrown away on the next
  event, so a wrong guess is never committed.
- **Drawing happens inside the pointer event**, not on the next animation frame.
  Apple's own advice for UIKit is the opposite, but WebKit dispatches pointer
  events from a plain main-thread task that is not aligned to the rendering
  update, so a hop through `requestAnimationFrame` costs up to a full frame and
  buys nothing, because coalescing already happened upstream.

Measured on a synthetic stroke at 1200 px/s: the ink reaches the pen exactly
with tip tracking alone, and about 7 px ahead of it with prediction on. Turning
the smoothing up puts the ink 7 px behind, which is what "laggy" feels like.

Own extrapolation is damped rather than trusted, because an overshoot past the
nib is the most visible artifact prediction can produce. Measured tail reach
past the pen:

| situation | ink ahead of the pen |
| --- | --- |
| straight, steady | 10 px |
| sharp direction change | 0 px |
| pressure collapsing as the pen lifts | 0 px |
| resuming after a 120 ms stall | 0 px |

Nothing that overlaps the canvas uses a backdrop filter or a large shadow. A
blurred bar over the drawing area has to be recomposited on every ink repaint,
and that shows up directly as writing lag.

A stroke is drawn as one clean fill for as long as it is a normal handwriting
length, and only starts committing in pieces past 300 points. Committing in
pieces draws every seam twice, and the doubled anti-aliasing makes live ink
visibly heavier than the same stroke redrawn later. Measured: 61% of inked
pixels changed on redraw before this, and 0% after, at a cost of under 2 ms per
event against a 16.7 ms frame.

## On smoothing filters

The app ships a light streamline lerp rather than a 1 euro filter, and the
measurements are why. On the same curve, with and without hand jitter:

| filter | strays from the real path | jaggedness |
| --- | --- | --- |
| streamline 0.2 | 0.1 px clean, 2.7 px jittery | low |
| 1 euro, 4.7 Hz | 15.6 px clean, 16.1 px jittery | low |
| none | 3.2 px jittery | high |

The 1 euro filter is genuinely better at rejecting jitter, but it pays for that
by dragging the line well off the path you actually drew, and it was also
producing visible kinks where the speed changed. That is the trade the switch
exists to let you feel. perfect-freehand, tldraw and Excalidraw all ship the
streamline lerp for the same reason.

## Presets

| Preset | Width | Smoothing | Ends |
| --- | --- | --- | --- |
| Notability | constant | light | blunt |
| Notability + pressure | pressure, wide range | light | blunt |
| GoodNotes fountain | pressure and speed | light | tapered |
| Apple Notes | pressure, widest range | medium | blunt |
| Raw input | constant | none | blunt |

Change any value and the preset becomes custom. The stats panel reports samples
per second, events per second, predicted points per event, handler cost and the
age of the input when it arrives.

## Running it

```bash
node tools/dev-static.mjs
```

Then open `http://localhost:5189`.

Icons are drawn as geometry, so every size rasterises exactly:

```bash
node tools/gen-icons.mjs
```

## Known limits

- Apple Pencil does not work on any iPhone, so this is an iPad app that happens
  to open on a phone. With a finger there is no pressure, and width falls back to
  speed.
- `getCoalescedEvents` and `getPredictedEvents` need Safari 18.2 or newer. The
  app detects both and falls back rather than failing.
- `getCoalescedEvents` also requires a secure context, so opening the dev server
  over plain http from another device silently drops to one sample per frame.
  The published HTTPS copy does not have that problem.
- `desynchronized: true` on a canvas context is deliberately not used. WebKit
  stores the flag and reports it back as enabled, but acts on it nowhere.
- Safari 18 and earlier report pointer coordinates as whole CSS pixels;
  fractional coordinates arrived in Safari 26. On older iPadOS a slow stroke has
  a 1 px lattice in it, which is part of what the smoothing is absorbing. This
  is a limit of the input, not of the rendering, and no amount of resolution
  fixes it.
- Settings persist in `localStorage`; the drawing itself is not saved.
