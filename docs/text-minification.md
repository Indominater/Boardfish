# Stable text during pan and zoom

The small-text renderer uses a shared, prefiltered glyph atlas and bounded,
object-local coverage tiles. It suppresses the coherent brightness bands produced
by dense paragraphs while retaining the existing MSDF rendering at readable
sizes. The real-board reproduction is `scripts/serve-text-motion.mjs`.

## What the earlier fix missed

The previous summed-area atlas integrated a one-pixel box. It prevented glyph
quads from missing pixel centers and largely conserved total ink, but a box
filter does not sufficiently suppress frequencies above the display's Nyquist
limit. Panning dense, aligned rows folded those frequencies into moving bands.
An entire line can alternate between one bright pixel row and two dim ones while
its integrated brightness stays constant. The earlier isolated-row energy test
therefore could not establish freedom from visible flicker.

The supplied board contains 72 objects: 66 images and six textboxes totaling
1,601,754 characters. Three textboxes each contain 495,781 characters. The app
was opened through its normal `.bf` reader and panned and zoomed with all objects
loaded. The comparison harness separately uses the same six textboxes and their
original geometry to isolate text rendering cost.

At 10% zoom and DPR 1, line pitch is 2.4 physical pixels. The second line harmonic
is 0.833 cycles/pixel and folds into a broad 0.167 cycles/pixel band. The benchmark
now measures spatial row contrast and fits source harmonics jointly over pixel
rows and pan phases. This distinguishes folded bands from legitimate motion of
the line structure. It also retains residuals and conditioning diagnostics;
these measurements do not claim that arbitrary moving content has zero pixel
variation.

## Shared glyph scale space

`scripts/generate-text-coverage.py` reconstructs coverage from the checked-in
Geist MSDF and convolves it with a Gaussian of sigma 0.65 physical pixels and a
one-pixel box **before** display sampling. Sixteen logarithmic layers cover 1.6
to 12 physical pixels per em. Each glyph uses a 64 by 64 cell with an adaptive
world-space extent, preserving resolution as its filter footprint shrinks.

The PNG transports IEEE binary16 values in its red and green bytes. Startup
reassembles these into one `R16F` texture, whose sampling and filtering are core
WebGL2 capabilities. Small strokes and punctuation retain values far below one
8-bit coverage step. There is no square-root encoding or packed-byte filtering
in the final implementation. The immutable atlas costs 12 MiB of GPU memory and
3,439,597 compressed PNG bytes. Its generator records source checksums and
verifies transport, tile padding, glyph mass, and subpixel translations.

The direct shader interpolates two neighboring layers with two bilinear texture
reads. Layer selection and coordinate transforms are computed once per draw;
per-fragment logarithms and glyph metadata calculations are avoided. The old
integral path remains available to callers supplying only that legacy font
resource, including historical benchmark comparisons.

## Reusing filtered text

When float render targets are available, the renderer retains object-local
512-pixel coverage tiles with two-texel gutters. Tiles sample a fixed font layer
at twice that layer's screen resolution. Camera position never enters their
identity. Two neighboring cached layers blend continuously as zoom changes.
Color and opacity are applied only when the complete textbox is composited, so
coverage can be reused across visual style changes.

Ordinary bilinear reconstruction of those tiles caused another phase-dependent
contrast change. The final tile shader uses a positive cubic B-spline, evaluated
with four bilinear reads. Its smooth reconstruction avoids that contrast pulse
without moving glyph positions. The gutter contains its complete support.

Tiles track the retained row records that contributed to them. Content, wrapping,
font geometry, or changed rows invalidate affected coverage. Newly exposed rows
can be appended additively without redrawing unchanged rows. Object movement
changes the tile transform. Warm panning submits tile quads instead of hundreds
of thousands of glyph instances.

The tile LRU is capped at 128 MiB. Tiles already used in a frame are protected.
When retention is exhausted, missing tiles pass through one reusable 532,512-byte
scratch framebuffer with exactly the same layer weights and cubic reconstruction.
Memory pressure therefore changes reuse, not the text filter. Evicted texture
and framebuffer allocations are recycled when their dimensions match. Cache
failure never drops text. Board reset, removal, disposal, and context restoration
release or rebuild the appropriate resources. Glyph instances retain their
existing independent 64 MiB limit.

Both paths accumulate glyph coverage before compositing text over the ordered
scene. The reusable viewport mask uses `R16F` when supported, with the existing
`R8` compatibility target otherwise. The compatibility path uses the same
prefiltered glyph data without requiring floating-point framebuffer support.

## Sharpness and boundaries

The glyph filter blends into MSDF between eight and twelve physical pixels per
em. Cached coverage also fades into the exact direct renderer between ten and
twelve, making the reading-size boundary continuous. At twelve and above the
MSDF treatment, high-zoom atlas, glyph positions, and layout are unchanged.
There is no motion/idle quality switch or delayed sharpening.

Text object and row culling include a 4.25-physical-pixel margin below twelve
pixels per em, covering the wider neighboring scale and cubic reconstruction.
Images keep their existing culling. The same text margin is used during editing.
Rotated and sheared transforms retain the existing direct MSDF path.

## Reproducing and validating

```sh
node scripts/serve-text-motion.mjs \
  --board /absolute/path/to/boardTest.bf \
  --baseline 15fdf59af6ef12789c479cd296f5136a4c6d68ec \
  --evidence /tmp/boardfish-motion
```

Open the URLs printed by the server. The full-board pages have controls for
loading the original file and running 240-frame pan and zoom sweeps, including
a page for the production build after `npm run web:build`. The text
comparison uses mounted 400 by 256 CSS-pixel canvases, explicit DPR 1/2, 32 pan
phases on both axes, and alternating performance blocks with 120 measured frames
per renderer. It records CPU submission, GPU timer queries when available, and
rAF intervals separately. Readbacks and PNG capture occur outside timed blocks.

The server reads the input board without modifying it, serves only that fixture
and repository assets, and obtains the previous renderer from the specified git
revision. Optional evidence writes are restricted to named outputs in the given
directory. The user's document and images are not included in the repository.

`?cache=0` disables tile reuse for the current panel. `?portable=1` disables the
optional float extensions on both panels for a matched compatibility comparison.
`?budget=0` retains the tile filter but streams every tile through the reusable
scratch target, exercising the memory-pressure path.
The benchmark records visibility and disjoint GPU-query status. Inspect native
PNGs and animated motion in addition to numerical summaries.

## Measured motion results — September 6, 2026

Chromium 152 on this Mac completed fourteen configurations: 10%, 12.5%, 15%,
20%, 25%, 50%, and 100% zoom, each at explicit backing-store DPR 1 and 2.
Both panels stayed mounted, foreground, and fully visible. GPU timer queries
were available for both renderers, with no disjoint blocks or renderer errors.
The baseline is commit `15fdf59af6ef12789c479cd296f5136a4c6d68ec`.

| Zoom / DPR | Aliased line amplitude, before → after | Row-contrast modulation, before → after |
| --- | ---: | ---: |
| 10% / 1 | 6.845% → 0.009% | 3.37% → 1.91% |
| 12.5% / 1 | 14.865% → 0.203% | 48.87% → 1.37% |
| 10% / 2 | 17.947% → 0.375% | 0.75% → 0.22% |
| 12.5% / 2 | 19.439% → 0.249% | 17.17% → 0.23% |

Aliased amplitude is the first source line harmonic above Nyquist, fitted over
the vertical pan sweep and expressed as a percentage of mean ink. Row-contrast
modulation is the peak-to-peak phase variation of spatial row-mean RMS contrast,
divided by its mean. These
measure different effects: a strong moving band need not change total contrast
much. At 10% / DPR 1, fitted alias amplitude fell by 99.87%. The warm 64-draw
phase sweep submitted zero glyph instances and reused 256 cached tiles.

| Zoom / DPR | Baseline GPU mean / median / p95 | Current GPU mean / median / p95 |
| --- | ---: | ---: |
| 10% / 1 | 2.285 / 2.470 / 3.571 ms | 0.926 / 0.283 / 4.624 ms |
| 12.5% / 1 | 1.734 / 1.377 / 2.923 ms | 1.017 / 0.241 / 7.116 ms |
| 10% / 2 | 2.642 / 2.299 / 4.583 ms | 1.580 / 0.396 / 6.590 ms |
| 12.5% / 2 | 2.250 / 2.114 / 3.839 ms | 1.127 / 0.392 / 5.040 ms |

The six-textbox tour includes newly encountered tiles. Reuse improved GPU mean
and median, while tile preparation increased GPU p95 in these cases. CPU
submission also rose: at 10% its median changed from 0.4 to 0.7 ms at DPR 1,
and from 0.3 to 1.7 ms at DPR 2. The additional preparation and retained memory
are real costs. Both paths had approximately 33 ms rAF intervals in this browser
run; these results do not establish a proportional application FPS improvement.

At 100% / DPR 2, the native before/after PNGs were byte-identical (156,898 bytes;
SHA-256 `bc67ab0598c9fe31efd11bbeb302a09eee7239ec51cfbae9b1e09f2fecc8373a`).
This confirms preserved reading-size output for that reference view. At low zoom
the filter deliberately suppresses unresolved detail to prevent aliasing;
neither the PNG comparison nor the band measurements establish zero artifacts
for every browser, GPU, or document.

The production application also loaded all 72 original objects, visited all six
textboxes, and completed 240-frame pan and zoom sweeps without browser warnings
or errors. The original file was unchanged. With retention forced to zero at
10% / DPR 1, all interior phase metrics matched the cached path exactly. Native
PNG differences were at most one 8-bit code value and confined to the top canvas
edge; the 24-pixel interior crop was identical. This exercised the single
532,512-byte scratch target without switching text filters.

With optional float extensions disabled on both panels, the direct compatibility
path also suppressed the alias band at 10% / DPR 1: 6.863% became 0.387%, a 94.37%
reduction. That path cannot reuse the float coverage tiles, and its GPU cost
increased: mean / median / p95 changed from 2.118 / 1.766 / 3.646 ms to
2.973 / 2.560 / 4.826 ms. It completed without browser warnings or errors. The
performance improvement therefore applies to the measured float-tile path;
it is not established for every WebGL2 device.

Browser lifecycle checks passed at 10% and 100% zoom with DPR 2, including edits,
wrapping, movement, deletion, ID reuse, and unchanged frames. The low-zoom check
confirmed that movement reused tiles and deletion released them. Forced context
loss/restoration at 10% / DPR 2 reproduced the same pixel checksum and rebuilt
the eight coverage tiles.

Run `npm run check`, `npm run web:build`, and
`python3 scripts/generate-text-coverage.py --check` for automated validation.
Current browser measurements are recorded in
[`gpu-render-results/board-motion.json`](gpu-render-results/board-motion.json).
The older `text-minification.json` is historical evidence for the insufficient
one-pixel box filter, not validation of the current implementation.
