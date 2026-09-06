# Retained GPU text renderer

Boardfish now selects a WebGL2 renderer at startup. The renderer retains ASCII
glyph instances, uses two precomputed MSDF font resources, and composites images,
text, selection, and carets in the same ordered canvas. Canvas2D remains the
compatibility backend when WebGL2 initialization fails. Existing non-ASCII text
remains stored and displayed through the compatible text raster path.

Small text now also uses an immutable summed-area font atlas and a shared
coverage mask. See [stable text at low zoom](text-minification.md) for the
pixel-area filter, retained-row preparation improvements, memory costs, and the
10%/12.5% pan measurements. The earlier measurements below describe the original
MSDF implementation; the current small-text behavior is documented there.

## Representation and sharpness

Each ink glyph occupies 12 bytes of instance data: local x, local y, and ASCII
code. The font atlas and glyph bounds are shared across all textboxes. Geometry
is grouped in absolute 64-row chunks and checked against existing layout text,
prefix positions, and measured baselines. New viewport arrays do not invalidate
unchanged glyphs. Camera and object movement update transforms; zoom updates
scale and resource bindings. None of these operations regenerate font pixels.

The two atlases are loaded before the MSDF backend begins drawing text:

| Resource | Pixels per em | Distance range | Used at |
| --- | ---: | ---: | --- |
| Reading/minification | 96 | 32 | Below 128 device pixels per em |
| Magnification | 192 | 4 | At least 128 device pixels per em |

Viewport zoom ranges from 10% to 1000%. Effective size is `16 × zoom × DPR`.
Both resources are needed within this range: the large resource starts at 800%
zoom at DPR 1 and 400% at DPR 2. The wider distance range supports small
text and minification; the narrow, higher-resolution resource reduces contour
quantization at extreme zoom. Both resources are immutable and already loaded,
so crossing the threshold requires no upload or deferred sharpening. The pair
costs 565,413 compressed PNG bytes and approximately 7.6 MiB of GPU texture data
including glyph metadata. Generation is documented in [ascii-font-atlas.md](ascii-font-atlas.md).

At 12 device pixels per em and above, the fragment shader reconstructs coverage
from linear MSDF data. Below 32 it integrates four half-pixel samples, blending continuously into
the single-sample path between 24 and 32. Sampling is bounded to the current
glyph so samples cannot reach packed neighbors. Below 12, the
[area-coverage path](text-minification.md#pixel-area-coverage) supplies minification
and blends into MSDF between eight and twelve pixels per em. This is grayscale
antialiasing with unchanged glyph positions, not ClearType or OS font hinting.
Text appearance is independent of whether navigation is active.

Camera and object/chunk origins are combined in JavaScript double precision
before upload. The shader receives local geometry and a nearby screen origin,
avoiding the loss of fractional positions when the board moves far from zero.

## Integration and ownership

- `src/js/gpu_renderer.js` owns shaders, buffers, textures, image tiles,
  compatibility glyph rasters, and context recovery. No GL handles enter object
  data, history, clipboard, or saved boards.
- `src/js/renderer.js` submits a complete existing viewport layout through
  `drawTextLayout`, bypassing per-line bitmap draws for supported ASCII.
- `src/js/viewport.js` uses that same path while editing, with selection before
  glyphs and the caret afterward. GPU composition preserves scene order without
  the Canvas2D editing image cache.
- `src/js/io_close.js` prepares GPU geometry during opening instead of drawing
  every line into dummy raster surfaces. Board replacement resets scene resources;
  undo/redo retains eligible resources and reconciles changed layouts.
- Both startup manifests include the font metadata and renderer before app
  initialization. The production build copies the atlases and the service worker
  caches both for offline use. Development counters are removed from release code.

Resource caches have explicit limits: 64 MiB of glyph buffers, 4,096 chunks,
128 MiB of image textures, and 16 MiB of compatibility text rasters. Buffer
allocation respects the aggregate budget before uploading. Requests exceeding
the retained geometry budget use the compatibility path rather than omitting
text. Images retain a power-of-two resolution pyramid selected from their device
pixel density, capped at native resolution. Each level uses tiles with sampling
gutters, preserving cropping, flipping, rotation, and alpha blending. This avoids
uploading native-resolution tiles for heavily minified images; see
[the image regression analysis and measurements](gpu-image-renderer.md).
Context restoration reconstructs both font resources and rebuilds scene resources
from application data on the next draw.

The layout engine remains authoritative for wrapping, custom pair spacing,
tab stops, selection, and caret positions. This change does not add horizontal
text culling, motion-dependent detail reduction, or work deferred until input
stops. Newly visible or edited content is prepared and painted in its requested
frame. Very large document layout and hidden-textarea synchronization remain
separate CPU costs.

## Verification

Run `npm run check` for semantic, resource/lifecycle, and production stripping
checks. Run `npm run web:dev` and open `/dev/gpu-text-benchmark.html` for mounted
browser comparisons, immediate continuous zoom, image/alpha probes, lifecycle
and context-restoration checks, and scale/coordinate precision checks. Native
PNG exports and pixel probes occur outside measured frames.

Browser results are recorded in `docs/gpu-render-results/`. These report CPU
submission and animation scheduling separately; neither is a GPU execution
timer or a guaranteed application FPS measurement. Keep both canvases visible
and foreground, and inspect native PNG pixels when the explicit test DPR differs
from the browser's DPR.

### Recorded browser results — September 6, 2026

Chromium 152 on this Mac, foreground mounted 400 × 256 CSS-pixel panels,
explicit backing-store DPR below. Actual browser DPR was approximately 1.11;
sharpness was inspected using backing-store PNG exports. Both panels remained
visible, with no hidden samples. These development measurements include counters
that are stripped from the production bundle.

| Workload | Cached lines CPU median / p95 | GPU CPU median / p95 |
| --- | ---: | ---: |
| Reading, 125% zoom, DPR 1; 256 glyphs | 0.2 / 0.5 ms | 0.2 / 0.3 ms |
| Dense, 25% zoom, DPR 2; 6,904 glyphs | 1.7 / 3.1 ms | 0.3 / 0.4 ms |
| Continuous 18–400% zoom, DPR 2; 12,245 glyphs | 3.4 / 5.1 ms | 0.4 / 0.6 ms |

Reading/dense tests measured 90 frames per path with alternating block order.
The dense case submitted the same 180 rows / 8,140 characters across four
textboxes: 180 cached-line draws versus four glyph draws (plus background).
Cold first-draw submission, after common layout preparation and font loading,
took 16.0 ms for cached lines and 1.2 ms for GPU geometry.

Continuous zoom measured 180 previously unvisited scales per path with fixed,
identical character coverage and no per-scale warmup. The GPU path uploaded
**zero glyph buffers, zero images, and zero font atlases** during that sequence.
Pixels matched exactly when the same transform was rendered during motion and
at rest. Both renderers had 16.7 ms median next-frame intervals; cached lines
had seven intervals above 25 ms and GPU text had none. This supports reduced
CPU work and improved scheduling headroom, not a proportional FPS claim.

Fourteen additional scale checks covered the then-supported 1–10000% zoom range
at DPR 2. The current benchmark covers 10%–1000%. Moving the test
glyph to coordinates (10,000,000, 10,000,000) and compensating the camera produced
identical pixels at every scale, with no geometry uploads after initial layout
preparation. The test follows a glyph stem at extreme magnification. Below one
device pixel per em, that isolated glyph can disappear through ordinary pixel
sampling; the test does not claim legibility at that size.

All eight opaque/translucent image probes matched Canvas2D, including Canvas and
ImageBitmap alpha. Editing, wrapping, movement, removal, ID reuse, and repeated
frames passed pixel checks. Forced context loss/restoration reproduced identical
pixels. Live app checks covered typing, selection/caret, undo/redo, both themes,
new-board reset, and text editing in the built production application.

`npm run check` passed 548 tests and the separate 25-test static run. The final
production build passed; release checks verify diagnostic counters are removed.
Windows-specific rendering/performance and other browser engines were not
measured in this session.

Raw evidence:

- [Reading JSON](gpu-render-results/reading-125-dpr1.json)
- [Dense JSON](gpu-render-results/dense-25-dpr2.json)
- [Continuous zoom JSON](gpu-render-results/continuous-zoom-dpr2.json)
- [Scale/precision JSON](gpu-render-results/scale-precision-dpr2.json)
- [Image/alpha JSON](gpu-render-results/mixed-order-alpha-dpr2.json)
- [Lifecycle JSON](gpu-render-results/lifecycle-dpr2.json)
- [Context restoration JSON](gpu-render-results/context-restoration-dpr2.json)
- Native 20 px/em: [cached lines](gpu-render-results/ppem20-retained.png),
  [GPU glyphs](gpu-render-results/ppem20-gpu.png).
