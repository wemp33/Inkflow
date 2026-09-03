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
3. **De-stair.** Safari reports the pen position in whole CSS pixels until
   version 26, so a slowly written curve arrives as a staircase on a 1 px
   lattice. That error sits at the very top of the frequency range the sample
   spacing can carry, while the shape of a letter sits far below it, so a
   Gaussian along the arc length erases the staircase and leaves the letter
   alone. This is the difference between curves that look drawn and curves that
   look polygonal, and no interpolating spline can do it: such a spline is
   obliged to pass through every jog.

   The radius **varies with how much the pen is turning**. Quantising to whole
   pixels leaves collinear runs whose length depends on the slope: measured on a
   real arc, a tread reaches **11 px** where the path runs shallow and is one or
   two pixels through a tight curve. One fixed radius therefore has to choose
   between leaving the long treads visible and rounding the corners off. So it
   smooths hard where the path is straight, which is exactly where there is no
   corner to lose, and barely at all where it turns. The radius is chosen from a
   first narrow pass rather than from the output it controls, so nothing feeds
   back on itself, and every window is a bounded distance, so points still settle
   and committed ink still never moves (measured: zero pixels).
4. **Curve.** A clamped uniform cubic B-spline, resampled to one vertex per
   device pixel, with a second subdivision floor on turn angle so tight bowls
   are not under-sampled. A B-spline *approximates* its control points rather
   than passing through them (noise gain 0.707 at a knot against Catmull-Rom's
   1.000), so whatever staircase survives stage 3 is averaged again rather than
   reproduced. Its support is the same four points as Catmull-Rom, so it costs
   no extra lookahead. Both ends carry multiplicity three, which clamps the
   curve to its endpoints: the last control point is the raw pointer position,
   and the drawn tip has to land exactly on it. Centripetal Catmull-Rom is
   still available in the settings.
5. **Width.** Constant, or from pressure, or from speed, or both. Pencil force
   is lifted by 1.25, eased, and smoothed by distance travelled rather than by
   time, so a resting pen cannot make the line drift thicker. The first sample's
   force is discarded because it is unreliable.
6. **Geometry.** The centreline is offset by half the width on each side and the
   ring is filled, so the edge is one anti-aliased boundary rather than a stack
   of overlapping round segments. A disc fills the notch at hard corners. The
   tangent is measured across a fixed 1.1 px of arc rather than between
   neighbouring vertices: those are a device pixel apart, and a central
   difference over them turns a hair of noise into a large error in the normal,
   which shows up as a lumpy edge.
7. **Two layers.** Settled geometry is committed to a canvas that is never
   cleared. Only a short live tail is redrawn per event, so the cost of an event
   does not grow with the length of the stroke.
8. **Pixel mapping.** The backing store is sized from the element's fractional
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

## Why curves used to look polygonal

Handwritten digits came out visibly faceted next to the same digits in
Notability, on the same iPad. Two compounding causes, both measured on a
simulated "9" written at 260 px/s with whole-pixel coordinates:

- Any segment shorter than the resampling step was emitted as a single point,
  which turned it into a straight line. At normal handwriting speed the stored
  points are about 1.2 px apart, so **85% of segments bypassed the spline
  altogether**.
- Catmull-Rom *interpolates*: it passes through every stored point, so it traced
  the 1 px staircase faithfully. Notability fits Bezier curves, which
  approximate.

The fix is the de-stair pass plus a minimum of two pieces per segment. Measured
on the filled outline, which is what the eye actually sees:

| | outline roughness (turn degrees per px) |
| --- | --- |
| before | 33.9 |
| tangent measured over a fixed span | 23.2 |
| plus the de-stair pass | **2.0** |

### How far this can go

Measured on the rendered silhouette, tracing its sub-pixel edge from the alpha
coverage, which is the least forgiving test available. First, the floor — what
the same measurement gives for shapes that have no input error at all:

| | silhouette wobble (RMS px) |
| --- | --- |
| a perfect ribbon filled as one analytic path | 0.059 |
| an ideal centreline through this outline renderer | 0.076 |

So 0.059 is the rasteriser's own limit and about 0.017 more is the cost of the
geometry stage. Everything above that is input error, and that is the part worth
attacking.

Then the pipeline itself:

| | silhouette wobble (RMS px) | worst |
| --- | --- | --- |
| Catmull-Rom, no de-stair | 0.326 | 2.28 |
| Catmull-Rom + de-stair 2.0 | 0.196 | 0.86 |
| **B-spline + de-stair 1.6** | **0.146** | **0.70** |

The B-spline beats the smoothest Catmull-Rom setting while smoothing 20% *less*.

Making the radius follow the turn beats every fixed radius on both axes at once.
Measured together with how far a drawn 90 degree corner falls short of the true
apex:

| | wobble | corner miss |
| --- | --- | --- |
| fixed 1.6 | 0.201 | 0.97 px |
| fixed 4.0 | 0.143 | 2.19 px |
| **turn-following, 3.0** | **0.146** | **0.62 px** |

It matches the smoothest fixed setting while keeping corners sharper than the
lightest one, and it cuts the input-induced part of the error by 44%. The
**Ease off at corners** switch turns it off.

Straying from the true path went *down* too, from 0.74 px to 0.59 px: the
staircase was itself an error, so removing it moves the ink closer to what was
drawn, not further away. Sharp corners survive — the maximum turn stays above
130 degrees. Per-event cost is unchanged at 0.7 ms median, 2.7 ms worst.

The radius is the **De-stair radius** slider. Zero reproduces the old behaviour.

Safari 26 reports fractional coordinates, at which point there is no lattice to
undo and this would be pure over-smoothing. The app watches the samples for a
fractional coordinate and, when one appears, cuts the radius to a third for the
rest of the session. Feature-detected from the input, never from the user agent.

**What was tried and rejected:** replacing the offset outline with the union of
the discs along the centreline, which is tangent-continuous by construction and
needs no normals at all. It measured no smoother and cost 29 ms per event
against a 16.7 ms frame, because canvas cannot rasterise a thousand convex
subpaths cheaply. The offset polygon with a fixed-span tangent is both faster
and, once the centreline is smooth, better.

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
