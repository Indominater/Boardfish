# Squircle text panels and overlap rendering

Every textbox now has an opaque panel with the context menu's fill, text color,
border, fourth-power squircle corners, outer outline, and drop shadow. The style
is read from the actual menu once at initialization and refreshed on theme
changes. It uses world units, so the panel and its shadow scale with the text.
The context menu remains dark in both themes, and the text on each panel remains
white. Panel corners are excluded from hit testing; shadows are not clickable.

## Rendering

`src/js/text_panels.js` shares the style and shape between the GPU renderer,
Canvas2D compatibility renderer, viewport bounds, and hit testing.
`src/js/gpu_renderer.js` draws the fill, border, outline, and shadow in one GPU
call per visible panel. Text continues through the existing retained MSDF glyph
path, with no additional text rasterization or intermediate textbox bitmap.

The shader evaluates the fourth-power contour and pixel coverage analytically.
The shadow combines Gaussian rectangle integrals with four corner corrections
from a shared 128 × 128 RGBA lookup. That lookup occupies 64 KiB and depends only
on corner radius and blur, not textbox dimensions or zoom. A four-entry cache
bounds style variants. Opaque interior pixels skip shadow calculations. Scene
resets retain the lookup; context restoration rebuilds it.

Panel edges and visible vertices are rebased near the camera in JavaScript
double precision before entering GPU float coordinates. A panel millions of
units tall therefore retains fractional edge positions at its visible bottom.
The shader's quad is restricted to the visible viewport, including shadow and
antialiasing margins. This is ordinary geometry clipping, without changing
quality during navigation.

Canvas2D traces the same squircle and uses its native shadow operation. The CSS,
Canvas2D, and GPU paths share the design values; their antialiasing and blur
sampling can differ slightly.

## Overlap handling

`src/js/panel_visibility.js` walks the scene from front to back and records
coverage guaranteed opaque by textbox bodies. A bounded cache of exact squircle
shapes handles small or coincident stacks. A screen-space grid handles coverage
from multiple panels, with at most 256 × 256 cells and a successor structure
that skips cells already covered.

The planner separately checks glyph bounds, panel bodies, and complete shadow
bounds. Covered glyphs skip layout and submission. Fully covered objects skip
all drawing; fully covered images also skip source resolution. Partly exposed
objects retain their normal painter order. Images have unknown alpha and do not
serve as opaque occluders. Image-only scenes bypass the coverage grid.

Antialiased corners and translucent shadows never count as opaque coverage.
Shadow bounds include four Gaussian standard deviations, the offset, outline,
and a device-pixel guard. Coincident panels can hide lower text while their
exposed shadows still accumulate. Removing those shadows would change the
visible result. Coverage is deliberately conservative at edges.

Editing uses the same panel and glyph path, with selection and caret above the
panel. The active textbox is planned in the same final layer used by its editing
overlay. The Canvas2D image-only editing cache is bypassed because it cannot
preserve interleaved opaque text panels and images.

## Validation and measurements

`npm run check` passed 595 tests plus the separate 25-test static run.
`npm run web:build` passed. Isolated Chrome checks of the actual app covered
typing, growing textbox height, selection, exiting and reopening editing, and
both themes; the production bundle also passed the editing and theme checks.

The browser harness is `/dev/text-panel-benchmark.html` under `npm run web:dev`.
Its `textPanelBenchmark` API provides `compareStyle()`, `checks()`,
`tallPanelPrecision()`, `run()`, and native PNG exports.

Recorded September 6, 2026 using Chrome 152 on this Mac, with mounted
400 × 300 CSS-pixel canvases at DPR 2. These are development measurements with
counters enabled. Each path uses 12 warmup frames and 90 measured frames.
CPU submission time includes the coverage planner; the baseline uses the same
new panels and glyph renderer with coverage skipping disabled.

| 1,000-textbox workload | Full painter CPU median / p95 | With coverage CPU median / p95 | Draw calls per frame, full → planned |
| --- | ---: | ---: | ---: |
| 999 boxes and their shadows fully behind one front panel | 41.8 / 54.6 ms | 2.2 / 3.5 ms | 2,001 → 3 |
| Separated boxes, all visible at small scale | 7.9 / 8.4 ms | 8.9 / 9.2 ms | 2,001 → 2,001 |

The three draws in the covered case are the canvas background, front panel,
and front glyphs. Both workloads uploaded zero glyph buffers, image textures,
font atlases, or panel lookups during measured frames. Coverage adds CPU work
when every textbox remains visible; it does not make that cost disappear.
These timings are not GPU execution times or application FPS guarantees. The
harness waits for animation callbacks before and after each sample rather than
running a sustained maximum-throughput frame loop.

Seven layer/shadow/image/theme cases matched the full painter's pixels exactly.
Three tall-panel comparisons matched a nearby short-panel reference exactly at
device scales 0.697, 0.713, and 1.31, including the visible bottom and shadow.
A 45-frame warm zoom/pan sequence uploaded no resources and produced identical
pixels at the same transform during motion and at rest. Windows and other GPU
or browser implementations were not measured.

Evidence:

- [Overlap measurements](gpu-render-results/panels-overlap.json)
- [Separated measurements](gpu-render-results/panels-separated.json)
- [Pixel, shadow, precision, and warm-resource checks](gpu-render-results/panels-checks.json)
- [Context menu style comparison](gpu-render-results/panels-style-1.json)
- [Production editing check](gpu-render-results/panels-production.json)
- [Overlapping panels](gpu-render-results/panels-staggered-corners-shadows-planned-dpr2.png)
- [Production textbox](gpu-render-results/panels-production-light.png)
