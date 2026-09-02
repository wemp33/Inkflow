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
2. **Filter.** Either a light streamline lerp or a 1 euro filter, both on
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

Measured on a synthetic stroke at 1200 px/s: the ink reaches the pen exactly
with tip tracking alone, and about 7 px ahead of it with prediction on. Turning
the smoothing up to a 1 euro filter at 0.4 Hz without tip tracking puts the ink
7 px behind, which is what "laggy" feels like.

Nothing that overlaps the canvas uses a backdrop filter or a large shadow. A
blurred bar over the drawing area has to be recomposited on every ink repaint,
and that shows up directly as writing lag.

## Presets

| Preset | Width | Smoothing | Ends |
| --- | --- | --- | --- |
| Notability | constant | light | blunt |
| Notability + pressure | pressure, wide range | light | blunt |
| GoodNotes fountain | pressure and speed | 1 euro | tapered |
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
- Settings persist in `localStorage`; the drawing itself is not saved.
