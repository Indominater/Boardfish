# Text rendering architecture

Boardfish renders ASCII text with a shared font atlas and retained WebGL2 glyph
geometry. It composites each textbox into the existing Canvas2D board in object
order. The hidden textarea still handles input; the existing layout engine owns
wrapping, spacing, selection, and caret positions.

This replaces repeated text rasterization and per-row bitmap compositing with
batched glyph rendering. It adds no horizontal glyph culling, navigation delay,
deferred text repaint, or change to the existing viewport-layout policy.

## Codebase findings

- [text_layout.js](../src/js/text_layout.js) handles native font measurement,
  prefix positions, wrapping, hit testing, and draw plans. Its general path uses
  grapheme iteration, font/string cache keys, and pair-spacing cache lookups.
  Caching a draw plan avoids repeated layout but still leaves text drawing work.
- [text_raster.js](../src/js/text_raster.js) previously improved repaint cost by
  retaining complete line bitmaps at discrete raster densities. A cold line still
  replayed `fillText`; a warm frame still checked state, looked up cached pixels,
  and composited each row. Every new density could allocate another set of pixels.
  Long rows and an over-budget working set fell back to direct drawing.
- [renderer.js](../src/js/renderer.js) already draws decoded images, generally
  with one `drawImage` per object. [image_variants.js](../src/js/image_variants.js)
  retains scaled image sources. Text needed a similarly reusable representation
  without storing an image for every line and zoom level.
- [viewport.js](../src/js/viewport.js) includes both normal board repainting and
  the editing overlay. Both now use the atlas renderer, so entering editing does
  not switch between two primary text rendering methods. Selection and caret
  drawing remain in Canvas2D.
- [io_close.js](../src/js/io_close.js) warms layouts when a board opens. Once the
  GPU renderer is ready, ASCII rows skip the former per-line draw-plan/raster
  warmup. Existing readiness and fallback handling still apply.
- [state.js](../src/js/state.js), [history_state.js](../src/js/history_state.js),
  and [editor_state_boundary.js](../src/js/editor_state_boundary.js) preserve
  runtime layout identities where appropriate. New GPU resources are managed
  outside serialized objects. [board_schema.js](../src/js/board_schema.js) still
  stores text as `data.content`; clipboard and board formats are unchanged.
- Board limits permit large documents and zoom ranges from 0.01 to 100. Retaining
  one raster of an entire textbox would make resource use depend heavily on its
  empty area and zoom. Glyph geometry instead scales with drawable characters.

## ASCII layout tables

Printable ASCII and tabs have a dedicated prefix-width path. A font-specific
`Float64Array(128)` holds lazily measured advances and a
`Float64Array(128 * 128)` holds pair adjustments. After relevant entries are
measured, each new paragraph uses indexed lookups instead of constructing font
keys, testing whitespace with regular expressions, and updating an LRU map for
every character. The two tables occupy 132,096 bytes, excluding small JavaScript
object overhead.

These values come from the existing native measurements. They retain the app's
minimum ink-gap rule, row-local tab stops, boundary-spacing corrections, and
baseline offset. Atlas advances do not replace these values. Measurement
invalidation clears the tables along with the existing layout caches.

Tabbed ASCII paragraphs use a forward width scan to find each row's fitted end.
This removes repeated substring/prefix reconstruction during binary width
searches. Word-break and consumed-whitespace handling still use the existing
rules, and every row consumes at least one character even when the first glyph
or tab exceeds its width. Non-ASCII content keeps the general grapheme path.

## Shared font atlas

[geist-ascii-msdf.png](../src/fonts/geist-ascii-msdf.png) is a static 512 × 512 RGB
multi-channel signed distance field (MSDF). Its
[metadata](../src/fonts/geist-ascii-msdf.json) describes 95 printable ASCII
characters, U+0020–U+007E. Space has metrics but no drawable quad; tabs advance
through layout without an atlas glyph. The atlas uses 64 pixels per em and an
8-pixel distance range.

It is generated from the repository's Geist 1.401 variable font with `wght=400`,
matching the app's font. Metadata records the source SHA-256, version, weight,
and pinned generation tools. The
[generation instructions](../scripts/generate-ascii-font.md) include a repeatable
build and a `--check` mode that verifies both generated files. Generation tools
are not runtime dependencies; the font's [OFL notice](../src/fonts/geist-ascii-OFL.txt)
is included with the assets.

The fragment shader reconstructs coverage from the median RGB distance and its
screen-space derivative, following the
[MSDFgen reference shader](https://github.com/Chlumsky/msdfgen#using-a-multi-channel-distance-field).
The texture is uploaded as linear distance data with image color conversion and
premultiplication disabled. Scaling changes a shader uniform, so it does not
generate another font texture or re-rasterize each line at a new density.

MSDF preserves scalable contours and sharp corners, but its finite source field
is an approximation. It does not reproduce native browser font hinting,
subpixel antialiasing, or every fractional-coordinate raster exactly. Small text,
thin strokes, extreme magnification, and light/dark backgrounds require visual
inspection in addition to layout tests.

## Retained geometry and Canvas2D composition

[text_gpu.js](../src/js/text_gpu.js) stores eight floats per drawable character:
a local destination rectangle and an atlas UV rectangle. Each instance occupies
32 GPU-buffer bytes. Character positions come directly from each line's existing
prefix-width array; glyph bounds are offset around the existing baseline.

Rows are grouped into stable bands of 32 visual rows in textbox-local coordinates.
Each geometry chunk covers at most 4,096 text positions, with spaces and tabs
omitted from uploaded instance storage. Stable interior bands remain reusable
when the existing viewport layout gains or loses a row; changed edge groups need
rebuilding. A long row is split into multiple chunks, so its character count
does not demand a very wide source texture.

Cache identities include immutable line text/prefix identities, character ranges,
and relative row offsets. Panning, zooming, object translation, and text color
changes use uniforms and reuse buffers. Editing or rewrapping creates new geometry
for affected groups; unchanged groups can remain cached. Warm draws still assemble
chunk descriptors and issue batches, but do not scan each character or upload its
vertices again.

Each chunk uses one
[`drawArraysInstanced`](https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.9)
call. All glyphs of the requested rows are submitted, including those beyond the
horizontal canvas edges. The GPU performs normal framebuffer clipping. The output
surface covers the intersection of textbox ink bounds and destination canvas;
this bounds scratch storage without shortening the submitted text.

A shared transparent WebGL2 scratch canvas draws one textbox, then one Canvas2D
`drawImage` composites its result into the board. The destination transform is
saved, temporarily reset for this device-pixel copy, and restored. Premultiplied
alpha and source-over blending preserve transparent edges and existing clipping.
Empty or fully clipped text needs no destination copy.

The bridge happens at the textbox's original position in the ordered object draw
loop. Consequently an image between two text objects remains between them, and
later Canvas2D selections/carets remain ordered correctly. This is a WebGL text
renderer with a Canvas2D composition bridge, not a replacement of the whole board
renderer. Cross-surface copies and synchronization are part of its performance
cost; the benchmark's GPU path includes that bridge.

## Budgets, lifecycle, and fallback

| Resource | Default policy |
| --- | --- |
| Retained glyph instance buffers | 16 MiB total |
| Retained geometry chunks | 512 entries |
| Text positions per chunk | At most 4,096 |
| Rows per stable geometry band | 32 |
| Atlas GPU storage | 1 MiB, uploaded as 512 × 512 RGBA |
| Shared scratch framebuffer | 64 MiB; grows by powers of two as needed within the byte budget, destination dimensions, and device texture/renderbuffer limits |

Geometry entries use least-recently-used eviction. Entries used in the current
frame are protected across textboxes, preventing an oversized repeated scan from
continually evicting useful buffers. Each textbox is preflighted before
composition. If its geometry cannot fit or required resources cannot be allocated,
that call falls back without leaving a partially composited textbox.

The GPU path requires loaded Geist metrics, the expected font, printable ASCII
with tabs, supported Canvas2D state, and a positive uniform scale/translation.
While atlas initialization is pending, after WebGL2/asset/shader failure, on
context loss, or for unsupported content/state/resource requirements, the caller
uses the retained line-raster path. That path in turn uses direct `fillText` for
unsupported states, partial ranges, non-ASCII text, or oversized raster entries.
Existing Unicode content is neither stripped nor changed. Text remains drawable
while initialization proceeds; readiness schedules a normal repaint.

`clearTextLayoutCaches` clears retained GPU geometry and compatibility rasters.
Font-measurement changes additionally reset ASCII tables and layout measurements.
The shared atlas/pipeline survives a geometry clear, while its scratch canvas
shrinks to 1 × 1. Context loss drops invalid
resource handles and switches to fallback; restoration rebuilds the pipeline and
subsequently rebuilds needed geometry. Explicit renderer disposal deletes buffers,
texture, VAO, and program, releases the decoded atlas image, and shrinks its canvas.
No GPU buffer or bitmap enters board data, history snapshots, or clipboard content.

The 16 MiB limit covers instance-buffer payloads only. The retained atlas image,
GPU texture, scratch framebuffer, Canvas2D destination, temporary geometry arrays,
driver allocations, and browser composition copies consume additional memory.
`atlasBytes` and `surfaceBytes` estimate four bytes per pixel; they are not a
complete GPU/heap measurement. The fallback raster cache independently allows
64 MiB, 2,048 line/density entries, 4 MiB per line, and 4,096-pixel tiles. Resource
behavior therefore needs browser/device measurement, consistent with
[WebGL memory guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).

## Diagnostics and verification

`getTextGpuStats()` reports readiness, context loss, cache entries and bytes,
estimated atlas/surface bytes, batches, glyph counts, uploads, hits/misses,
evictions, fallbacks, and the last error. Renderer reports add `textGpuObjects`,
`textGpuBatches`, and `textGpuUploadedBytes`. `textDrawCalls` counts destination
composition calls; GPU batches are reported separately. Existing
`getTextRasterCacheStats()` and raster counters describe fallback work. Cache
counters accumulate over the renderer lifetime; compare deltas around a workload.
Production builds strip developer diagnostic instrumentation.

Run the repository checks and build:

```sh
npm run check
npm run web:build
```

Focused structural tests are `test/text_gpu.test.js` and
`test/text_ascii_layout.test.js`. They cover geometry positions and UV orientation,
complete horizontal glyph submission, stable bands, buffer reuse, budgets,
current-frame protection, context loss/restoration, every printable ASCII pair,
tab wrapping parity, and large tabbed paragraphs. Existing text/editor/renderer
tests cover surrounding behavior. Most Node rendering tests use mocked contexts,
so passing them establishes contracts rather than real GPU speed or pixel quality.

Serve `npm run web:dev` and open `/dev/text-render-benchmark.html`. The
[benchmark page](../src/dev/text-render-benchmark.html) offers direct text, retained
line rasters, GPU text including composition, a prebuilt image reference, and an
empty-destination baseline. It explicitly reports an unavailable GPU path instead
of benchmarking a silent fallback as GPU text.

- Run **renderer verification** for camera/color reuse, one-row navigation,
  edits, width changes, a 6,000-character row, clipping, and image/text ordering.
- Run **mounted canvas animation comparison** in a foreground visible tab. Select
  prose, code, a wide row, and the dense board across DPR 1/2 and several scales.
  Eight alternating blocks supply 10 warmup plus 45 measured frames each, yielding
  90 measured frames per rendering path. The image source is prebuilt outside
  timing; its cost is a compositing reference, not an image decoding benchmark.
- Use snapshot replay and CPU readback as separate stress/completion modes.
  Snapshot transfer does not establish GPU completion or presentation. Full-canvas
  `getImageData` includes readback costs and can alter browser acceleration behavior.
- Inspect the visual comparison for all ASCII punctuation, f/tt combinations,
  descenders, tabs, light/dark text, fractional origins, and zoom extremes. In the
  real app also check edit entry, selection/caret movement, resize, undo/redo,
  theme changes, font readiness, and overlapping image/text objects.

Keep text, layout, viewport coverage, DPR, input sequence, browser, and build mode
identical between comparisons. Measure layout, cold GPU preparation, warm draw
submission, frame pacing, and memory separately. Mounted rAF intervals include
browser scheduling and rendering pressure; they are neither precise GPU latency
nor confirmed presentation timestamps. Fewer calls or faster submission alone
does not prove a higher application frame rate. Browser coverage and performance
claims should name the tested browser/device, and release builds need a smoke check.

## Measured results

The final mounted-canvas run on September 6, 2026 at 06:48 UTC used Chromium 152
in the Codex in-app browser on the local Mac. The visible canvas was 1,024 × 640
CSS pixels at an explicitly selected DPR of 2 and 25% zoom. The dense workload
contained 267,279 characters across 24 textboxes; the prepared viewport submitted
36,246 characters across 642 rows and six textboxes. Each path supplied 90 measured
frames, with no hidden-tab frames. The GPU path includes its Canvas2D bridge.

| Path | Draw submission median / p95 | rAF interval median / p95 | Intervals >25 ms |
| --- | --- | --- | --- |
| Direct text | 7.2 / 7.6 ms | 16.7 / 33.4 ms | 12 / 90 |
| Retained line rasters | 4.2 / 4.6 ms | 16.7 / 16.8 ms | 0 / 90 |
| GPU atlas with Canvas2D composition | 1.0 / 1.4 ms | 16.7 / 16.8 ms | 0 / 90 |
| Prebuilt single-image reference | 0.1 / 0.2 ms | 16.7 / 17.2 ms | 0 / 90 |

The GPU path reduced median warm drawing submission time by 4.2× relative to the
existing line cache. Both paths maintained approximately 60 Hz frame pacing in
this run; this is not a 4.2× application frame-rate claim. A prebuilt single image
remains cheaper than rendering all glyphs and compositing six textboxes.

Warm GPU frames used 24 instanced batches and six destination copies, versus 642
destination copies for retained rows. Upload counters did not increase during
the animation, and there were no GPU fallbacks. The retained geometry used
983,040 bytes across 24 chunks, with a 1,048,576-byte atlas and a 1,310,720-byte
scratch surface. These payload estimates exclude the decoded atlas image, driver
overhead, destination canvas, and other browser allocations.

Cold GPU submission took 19.4 ms with the atlas/pipeline already initialized and
the viewport layout prepared. This is not total cold board-open latency. The
animation uses prepared rows and fractional horizontal camera movement; it does
not measure dynamic layout work during vertical navigation. Separate real-browser
verification passed one-row navigation reuse, edits, rewrapping, color and zoom
changes, a 6,000-character unwrapped row at 100× zoom, transform restoration,
Unicode fallback, and interleaved image/text composition.

Production smoke checks covered typing ASCII and tabs, wrapping, selection/caret
display, and undo/redo without browser console errors. Visual comparisons at DPR
1 and 2 showed the expected antialiasing differences from native text. Performance
and visual coverage here are limited to Chromium on this Mac; Safari, Firefox,
mobile hardware, and unusually small or large text need their own measurements.

`npm run check` passed all 547 main tests and 25 static guard tests, and
`npm run web:build` produced the production bundle successfully.

## Historical line-raster measurements

The previous implementation's repository notes recorded a September 6, 2026
Chromium run in the Codex in-app browser. These results describe the earlier
line-raster change and do not measure the new MSDF renderer.

The mounted 1,024 × 640 CSS-pixel canvas at DPR 2 and 25% zoom submitted 36,246
characters. Direct text took 7.2 / 7.6 ms median/p95 submission; retained rows took
4.3 / 4.6 ms. Of 90 intervals per path, direct had 13 over 25 ms and retained had
none. Retained output still needed 642 destination image calls.

In its separate snapshot replay, that dense case retained 6,737,676 bytes and
took 65 ms for initial raster preparation plus 7.7 ms for layout/plans. A
6,000-character unwrapped row exceeded the 4 MiB line limit at 100% zoom and above,
fell back to direct text, and gained no material speedup.

CPU readback stress showed why submission improvements need qualified claims:
the dense case improved from 18.5 to 12.2 ms median, while prose at 100% regressed
from 4.2 to 6.1 ms and prose at 200% from 3.9 to 7.3 ms. Those readback timings
include pixel transfer and backend effects; they are not mounted-canvas frame
latencies or predictions for the new GPU bridge.
