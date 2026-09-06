# Text rendering architecture

Boardfish stores plain text and implements its editor over Canvas2D. A textarea
provides input and selection state; the canvas draws the visible text, selection,
and caret. There is no rich-text document model to remove. The expensive recurring
work was replaying text drawing commands after the layout was already cached.

## Findings from the codebase

- `src/js/text_layout.js` owns font measurement, character positions, wrapping,
  caret hit testing, and draw plans. The existing plan cache saves JavaScript
  layout work, but a cached plan still issues `fillText` for its constituent runs
  whenever it is drawn. ASCII batching reduces the number of runs without
  retaining the rendered result.
- `src/js/renderer.js` draws text through `drawTextLineRange`. Images already
  arrive as decoded bitmap sources, with reusable scaled variants managed by
  `src/js/image_variants.js`. A ready image generally needs one destination
  `drawImage`; a text line could require many destination `fillText` calls.
- `src/js/viewport.js` repaints the board for navigation. During editing it caches
  background and images, then redraws the unchanged text and edited text. Text
  therefore needs reusable pixels in both ordinary and editing paths.
- `src/js/io_close.js` prepares text layouts and draw plans when opening a board.
  Its scratch-canvas warmup previously discarded the pixels it generated. The
  shared line drawing function now populates reusable raster entries during this
  existing work.
- `src/js/state.js`, `src/js/history_state.js`, and
  `src/js/editor_state_boundary.js` manage object identity, text changes, and
  history snapshots. Raster resources belong to runtime state and never enter
  history snapshots or saved board files.
- `src/js/board_schema.js` serializes text as `data.content`.
  `src/js/clipboard_export_init.js` copies text as plain text. Image exports use a
  separate path. The renderer change does not require a board-format change.
- `src/js/board_limits.js` allows 100 objects and 500 MiB of board content.
  `src/js/viewport_state.js` permits zoom from 0.01 to 100. Large text documents
  and extreme zoom make one full-textbox raster an unsuitable memory policy.

## Retained ASCII line rasters

`src/js/text_raster.js` adds a bounded cache of rendered text lines. On the first
draw of an eligible line, the existing immutable draw plan is rendered to one or
more small CPU-backed staging canvases and synchronously transferred to immutable
`ImageBitmap` tiles. Later frames composite those pixels with `drawImage`. Browsers
without the synchronous bitmap API retain the canvas instead. The
text content, glyph positions, wrapping, and selection geometry still come from
the existing layout engine.

The normal board renderer and active editor both call `drawTextLineRange`, so
they use the same cache and rasterization. This avoids maintaining different
text appearances when editing starts or ends. Printable ASCII and tabs are
eligible. Other existing content, partial-line draws, unsupported canvas state,
and entries exceeding resource limits retain the direct text path; stored text
is never stripped or replaced.

The cache is keyed by draw-plan identity, font, text color, raster density, and
local ink bounds. Object position and canvas translation are excluded. Panning,
moving a textbox, and changing its selection can reuse its rendered pixels.
Content or wrapping changes create a new plan, so stale pixels cannot be reused
for different text.

Raster density rounds upward in steps of the square root of two, with a minimum
density of one eighth of a device pixel per world unit. Zoom and device-pixel-ratio changes
reuse an entry within a density step or synchronously construct a new entry.
The selected density is at least the current destination density. This keeps
allocation bounded across small zoom changes without waiting for a gesture to
finish. Cached raster text can have different antialiasing from direct browser
text at fractional coordinates, so visual checks remain part of verification.
Tiles use bilinear sampling: their density already matches or exceeds the
destination density, so expensive photo resampling is unnecessary.

Horizontal tiling bounds individual canvas dimensions. Tiles have gutters and
use source crops when composited so neighboring tiles do not double-blend their
overlap. Measured ink bounds select which glyphs touch each tile during construction,
including glyphs crossing tile boundaries. All tiles are drawn, without horizontal
viewport culling; tile construction never depends on viewport position.

Default resource limits are:

| Resource | Limit |
| --- | --- |
| Retained raster bytes | 64 MiB |
| Retained line/density entries | 2,048 |
| Raster bytes for one line entry | 4 MiB |
| Width or height of one canvas | 4,096 pixels |

Entries are evicted in least-recently-used order before allocation. Entries used
in the current frame are protected; excess lines draw directly when the working
set exceeds the budget. This prevents a sequential scan of more than 2,048 rows
from evicting every entry just before its next use. It does not omit any content.
Disposal closes bitmaps and releases staging canvas backing storage. Clearing text caches or changing text color
also releases retained rasters. The limits count RGBA canvas dimensions,
including tile gutters; they do not measure browser overhead or GPU copies.
Very wide lines or extreme zoom can fall back to direct rendering rather than
attempting oversized allocation.

This changes the representation of stable text between frames. Existing frame
scheduling, viewport culling, and immediate rendering remain the same. It does
not add delayed text rendering, hide text while navigating, or reduce horizontal
coverage. It also does not eliminate the cold cost of layout, raster generation,
or rewrapping after a width change.

## Why this approach

Direct HTML text would give layout and painting ownership to the browser. In
this application it also requires reconciling custom wrapping and hit testing,
editor selection, zoom transforms, and arbitrary image/text stacking with DOM
elements. It is a possible broader redesign, but it does not by itself establish
a faster renderer for Boardfish's workload.

A shared ASCII glyph atlas can keep glyph resources small. A Canvas2D atlas that
issues `drawImage` per character still incurs a JavaScript/API call per character.
Retained glyph geometry with batched GPU draws is the more substantial option,
but requires a GPU rendering pipeline and a solution for image/text stacking.
The existing board acquires a Canvas2D context; a separate GPU text layer above
it cannot represent every interleaved object order.

Retained line rasters fit the current drawing pipeline, preserve its geometry,
and amortize repeated text rendering with bounded memory. They also provide a
measurable intermediate architecture before committing to a full GPU renderer.
This follows the browser's established [pre-rendering pattern](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas).
Transferred bitmaps are explicitly [closed when evicted](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/transferToImageBitmap).

## Diagnostics and verification

Developer draw reports distinguish work submitted to the destination canvas from
work used to construct a cached raster:

| Field | Meaning |
| --- | --- |
| `textDrawCalls` | Destination text calls, including raster blits or direct fallback |
| `textRasterDrawCalls` | Destination raster blits |
| `textRasterCacheHits` | Lines drawn from an existing raster entry |
| `textRasterCacheMisses` | Lines that successfully built a raster entry for this draw |
| `textRasterizedDrawCalls` | Text calls used to construct new raster entries |
| `textDirectDraws` | Objects with at least one direct text drawing call |

These renderer counters describe ordinary text-object draws; editing overlay
timings are reported separately. `getTextRasterCacheStats()` reports cache-wide
hits, misses, fallbacks, evictions, draw calls, retained bytes, and entry count,
including edited text. These are runtime cache totals, so compare deltas over the
measured interval. `clearTextRasterCache()` releases entries while preserving the
lifetime counters.

The existing performance tools in `src/js/debug_manual_perf.js` can collect cold
and warm layout passes, navigation, editing, resizing, and memory reports. For
before/after comparisons, keep text, viewport, culling, input sequence, and build
mode identical. Include many short boxes, a long unbroken line, wrapped ASCII
paragraphs, many short lines, tabs, and interleaved text/images. Check fractional
pan and zoom, DPR 1/2, edit entry, selection and caret movement, insertions,
rewrapping, history restoration, theme changes, and font readiness.

Measure cold preparation separately from warm frames and record both frame
latency and retained memory. Zero destination `fillText` calls on a warm eligible
line demonstrates reuse, but is not a measured wall-clock speedup. Node tests use
mock canvas contexts, so browser raster/compositor behavior requires a real
browser measurement. Production builds strip developer diagnostic code and must
also be checked.

### Browser performance results

Measured locally on September 6, 2026, in Chromium through the Codex in-app
browser. The reproducible page is `src/dev/text-render-benchmark.html`, served by
`npm run web:dev` at `/dev/text-render-benchmark.html`; it is excluded from the
production build. These runs use a 1,024 by 640 CSS-pixel destination, DPR 2,
30 samples per path, four warmups, and identical text/layout/coverage.

The **mounted-canvas animation comparison** uses a visible HTML canvas with its
default accelerated context, identical fractional panning steps, and no destination
pixel readback or bitmap transfer. Four alternating blocks (direct, retained,
retained, direct) each include 10 warmup frames and 45 measured frames. The dense
36,246-character workload at 25% zoom and DPR 2 produced:

| Metric | Direct text | Retained text |
| --- | --- | --- |
| Draw submission median / p95 | 7.2 / 7.6 ms | 4.3 / 4.6 ms |
| Next animation-frame interval median / p95 | 16.7 / 33.4 ms | 16.7 / 17.8 ms |
| Frame intervals over 25 ms | 13 of 90 | 0 of 90 |
| Samples while document was hidden | 0 | 0 |

This demonstrates lower draw work and improved frame pacing for the tested
workload. Animation-frame intervals include browser scheduling and rendering
pressure; they are not precise GPU latency or a guarantee for every board/device.

Snapshot replay transfers the output to a bitmap after each sample, without
reading pixels into JavaScript. It measures draw submission plus snapshot
handling, **not GPU completion, presented-frame latency, or application FPS**.

| Workload | Zoom | Submitted characters | Direct median / p95 | Retained median / p95 | Destination calls: before → after |
| --- | --- | --- | --- | --- | --- |
| Prose | 25% | 9,204 | 5.4 / 5.9 ms | 0.9 / 1.2 ms | 4,607 text → 107 image |
| Prose | 100% | 2,324 | 1.5 / 3.1 ms | 0.3 / 0.8 ms | 1,167 text → 27 image |
| Indented code | 100% | 571 | 0.4 / 0.5 ms | 0.2 / 0.4 ms | 323 text → 27 image |
| 24 large textboxes | 25% | 36,246 | 20.1 / 21.9 ms | 4.3 / 4.8 ms | 18,258 text → 642 image |
| 24 large textboxes | 100% | 4,440 | 1.7 / 2.0 ms | 0.6 / 1.0 ms | 2,250 text → 81 image |

The dense 25% case retained 6,737,676 bytes. Its initial raster preparation took
65 ms in this run, separately from 7.7 ms of layout/plan preparation. This change
amortizes that cold work; it does not eliminate it. A deliberately very wide
6,000-character unwrapped row exceeded the per-line byte limit at 100% zoom and
above, used the direct fallback, and showed no material speedup.

The separate **CPU readback stress mode** requests all destination pixels through
`getImageData` on every sample. In that mode, the dense 25% case improved from
18.5 to 12.2 ms median, but prose at 100% regressed from 4.2 to 6.1 ms and prose
at 200% from 3.9 to 7.3 ms. Readback changes canvas backend behavior and adds
pixel transfers; do not treat snapshot wins as universal rendering gains.
Early mutable-canvas and GPU-backed-staging variants were slower in this stress
mode and were replaced during development. The final staging path requests
CPU storage and transfers immutable bitmaps synchronously.

Visual checks covered the ASCII alphabet and punctuation, tabs, f/tt cases,
descenders, light/dark colors, fractional pan and 125% zoom. Wrapping and selection
geometry remain unchanged; pixel antialiasing is not identical. The production
bundle was also checked for text entry and selection with no browser errors.
