# Continuous zoom over large textboxes

These measurements describe the zoom changes in bundle `972732412ad0`, before
the subsequent textbox background and input changes documented in
[textbox-behavior.md](textbox-behavior.md).

Repeated zoom over the large-text fixture reduces DPR 2 GPU p95 from 51.98 ms
to 15.60 ms while preserving exact reading-size output. The change removes
repeated paragraph wrapping and zoom-dependent coverage-tile creation. Median
GPU cost and some pan cases increase; the measurements below retain those
tradeoffs.

The reproduction uses the user's original `boardTest.bf`, which contains 72
objects, including six textboxes with 1,601,754 characters in total. The largest
three textboxes each contain 495,781 characters. The text renderer comparison
retains their actual content and world geometry and anchors zoom at the center
of `obj-545`. The full-app reproduction also includes the board's 66 images.
The fixture server reads the input document without modifying it.

Two independent costs made zoom expensive. Changing the visible line range
repeatedly scanned one enormous paragraph and copied prefix-width arrays for
rows outside that range. The GPU then populated object-specific coverage tiles
at successive filter scales. Panning could reuse those tiles, but continuous
zoom crossed their scale boundaries and repeatedly paid the rasterization cost.
A warm panning measurement therefore did not characterize zoom responsiveness.

The layout index now retains the character boundaries of each wrapped visual
line. A viewport request looks up the requested rows and materializes only
missing row records. The paragraph's existing prefix widths remain the source
of wrapping and caret geometry. A width, content, or font change invalidates the
relevant index; camera motion does not. This preserves the original line breaks
and positions while removing repeated scans during a zoom gesture.

The browser layout benchmark expanded a requested range from rows 100–104 to
100–183 over 80 frames with the real Geist font loaded. These numbers are from
the same 495,781-character textbox before and after the index change:

| Measurement | Previous layout | Indexed layout |
| --- | ---: | ---: |
| Median request CPU time | 4.6 ms | 0.1 ms |
| p95 request CPU time | 5.1 ms | 0.3 ms |
| Characters visited by repeated wrapping | 39,662,480 | 0 |
| Prefix-width slices allocated | 25,120 | 84 |
| Prefix-width slice bytes allocated | 317,300,480 | 1,062,864 |
| Additional visual-line index storage | 0 | 6,280 bytes |

The character count is traversal work, not a byte allocation estimate. The
prefix-width byte count measures the sliced typed arrays, not total JavaScript
heap allocation. The final requested layout and reference layout had identical
hashes. Initial paragraph preparation still scans the document once: the
measured preparation times were 45.0 ms before and 48.8 ms after. Those initial
costs are excluded from the repeated-request table and are not claimed to have
improved.

The retained GPU instances now have a spatial index as well. Each chunk groups
glyphs into fixed 1,024-world-pixel horizontal bins, with row spans inside each
bin. CPU clipping submits the visible spans instead of sending the full width
of every retained row to the vertex shader. The clip guard includes glyph and
filter support, with outward rounding at float32 boundaries. Positions and
glyph instances remain object-local and unchanged as the camera moves.

The fused filter moves the coverage-tile reconstruction kernel into
the immutable shared glyph atlas. The previous atlas provided a Gaussian and
pixel-box filter; drawing cached tiles then applied a positive cubic B-spline.
Both filtering and coverage accumulation are linear, so their convolution can
be computed for each reusable glyph before runtime. The fused atlas incorporates
the cubic kernel directly rather than approximating it by increasing Gaussian
blur. Continuous zoom then interpolates shared font scale levels and draws the
visible glyph spans into the reusable viewport coverage mask. Between eight and
twelve physical pixels per em, the MSDF contribution receives a positive
four-offset filter matching the variance of the former cubic reconstruction.
This uses sixteen MSDF texture samples only within that transition interval.
Its strength fades between ten and twelve em, leaving the existing MSDF path
unchanged at twelve and above.

This removes the need to build and retain the former 128 MiB object-specific
coverage-tile cache in the default fused path. It does not remove retained glyph
geometry, the shared font atlas, or the viewport mask. There is no separate
motion-quality mode or delayed sharpening. The reading-size MSDF path remains
the reference above the minification transition. Pixel identity and phase
behavior are verified below.

The old cache could composite a warm
static-scale pan using only texture quads. The fused path submits visible glyph
spans every frame. Its purpose is to eliminate the cache-population spikes
during zoom and avoid filter changes between cached and uncached rendering;
the fixed-zoom measurements below show that pan GPU percentiles vary.

The final DPR 2 zoom run used the fused atlas, spatial glyph clipping, and a
shader early exit for exactly zero coverage, which avoids transparent blending
without discarding nonzero strokes. Both panels were fully visible before and
after the run. Every GPU query resolved without a disjoint event, and there were
no renderer errors. The run includes the corrected MSDF transition filter.
Earlier reproduction tabs and full-board contexts were closed before this
matched run. Full per-frame samples and the layout evidence are retained in
[board-zoom.json](gpu-render-results/board-zoom.json).

| 1,200 × 800 CSS pixels, DPR 2 | Previous | Final |
| --- | ---: | ---: |
| Cold zoom GPU median / p95 | 2.97 / 54.87 ms | 5.57 / 20.87 ms |
| Repeated zoom GPU median / p95 | 3.99 / 51.98 ms | 5.97 / 15.60 ms |
| Cold zoom GPU mean / maximum | 11.47 / 337.71 ms | 7.99 / 34.82 ms |
| Repeated zoom GPU mean / maximum | 11.59 / 163.23 ms | 7.43 / 29.35 ms |
| Cold zoom CPU median / p95 | 2.0 / 4.6 ms | 0.3 / 0.6 ms |
| Repeated zoom CPU median / p95 | 6.0 / 11.1 ms | 0.3 / 1.1 ms |
| Text tile bytes retained | 134,193,024 | 0 |

The reduction is in expensive zoom frames and average GPU work. Median GPU time
increases because the old cache made its successful reuse frames inexpensive.
The new path still has cold setup work: the maximum cold CPU submission was
26.3 ms, and the maximum cold GPU sample was 34.82 ms. These maxima are different
measurements and should not be added as if they necessarily occurred in one
serial stage. The median rAF interval was 16.7 ms for both renderers in both
passes. GPU timestamps and browser scheduling do not establish a universal FPS
guarantee.

At DPR 1, the same full-size workload also improves the expensive zoom frames,
with a different average-GPU tradeoff:

| 1,200 × 800 CSS pixels, DPR 1 | Previous | Final |
| --- | ---: | ---: |
| Cold zoom GPU median / p95 | 1.58 / 31.80 ms | 4.25 / 13.57 ms |
| Repeated zoom GPU median / p95 | 1.67 / 15.90 ms | 3.65 / 12.96 ms |
| Cold zoom GPU mean / maximum | 5.74 / 95.72 ms | 5.27 / 31.22 ms |
| Repeated zoom GPU mean / maximum | 3.69 / 52.41 ms | 4.79 / 24.09 ms |
| Cold zoom CPU median / p95 | 2.2 / 4.1 ms | 0.3 / 0.6 ms |
| Repeated zoom CPU median / p95 | 1.6 / 2.5 ms | 0.3 / 0.6 ms |

The repeated DPR 1 GPU mean increases even though its p95 and maximum decrease.
Cold CPU setup reaches 42.0 ms. The artifact keeps all 1,920 zoom frame samples
across DPR 1 and 2 so these tradeoffs remain visible.

The separate fixed-zoom pan tour uses 400 × 256 CSS-pixel panels and visits all
six textboxes, including newly exposed rows. It includes cache reuse and cache
population, so it is not a fully warm static-viewport test. Each configuration
has 120 measured frames per renderer after block warmups. At 10% zoom and DPR 1,
GPU median / p95 changed from 6.10 / 10.72 ms to 4.42 / 10.55 ms. At 25% zoom and
DPR 2, they changed from 3.59 / 8.15 ms to 4.27 / 10.10 ms. All 14 configurations,
their CPU/GPU/rAF summaries, visibility snapshots, and query validity counts are
retained in the evidence artifact. These results do not support a claim that
every pan case is faster.

The phase sweep covers zooms 10%, 12.5%, 15%, 20%, 25%, 50%, and 100%, at DPR 1
and 2. At 10% / DPR 1, coherent aliased line amplitude changed from 0.008713% to
0.022976% of mean ink, while row-contrast modulation improved from 1.907902% to
0.975588%. This is a small absolute increase in one alias metric, not an
improvement in every metric. For example, 12.5% / DPR 2 row modulation increased
from 0.231344% to 0.551661%. The largest relative change in mean ink across all
14 configurations was 0.0443%. The artifact preserves all configurations and
their fit residuals and conditioning; it does not claim zero temporal variation.

Pixel verification compares eight views at each of 14 zooms for both DPRs,
including interior and viewport-edge locations around the x = 1,024 glyph-bin
boundary. All 64 tested views at or above 12 physical pixels per em are exactly
equal in every RGBA channel. At or below eight physical pixels per em, the
maximum interior difference is two 8-bit channel codes; the maximum edge-strip
difference is three. The final 100% / DPR 2 native PNGs are also byte-identical,
with SHA-256 `bc67ab0598c9fe31efd11bbeb302a09eee7239ec51cfbae9b1e09f2fecc8373a`.

The additional 62.5% / DPR 1 phase check measures ten physical pixels per em,
inside the transition. With the positive MSDF reconstruction filter, coherent
aliased line amplitude improved from 5.977724% to 5.202004% of mean ink, and
row-contrast modulation improved from 1.039248% to 0.760435%. This confirms that
removing the tile cache does not require dropping reconstruction filtering from
the MSDF contribution.

The corrected pixel rerun preserves all 64 exact reading-size views. Within the
transition, the largest difference from the previous cached renderer is 24
8-bit channel codes; at ten em, the maximum is 14 codes and RMS is approximately
1.4 codes. The transition thus preserves comparable filtering without claiming
pixel identity to its former cached-grid reconstruction.

All 593 automated tests and 25 static checks pass, and the production build
succeeds with bundle hash `972732412ad0`. Eight browser lifecycle checks pass at
10% zoom / DPR 2, covering visibility, editing, resizing, movement, deletion,
replacement, and unchanged-frame stability. Moving text uploads no buffers;
deleting it releases retained glyph buffers. Context restoration reproduces the
same 800 × 512 image checksum, `9822961a`, and 2,804 ink pixels. These lifecycle
and restoration results were observed in the browser benchmark's DOM; they do
not have a separately exported raw-result file.

The final production build opened the original document through the normal
reader, displayed all 72 objects, visited all six textboxes, and completed zoom
and pan sweeps centered on the largest textbox without warning or error logs.
At a 1,440 × 900 backing canvas and the browser's actual DPR of approximately
1.11, the 240-frame 10%–35%–10% zoom sweep had rAF median / p95 / maximum of
16.7 / 17.6 / 22.3 ms. The 240-frame pan at 10% measured 18.2 / 20.3 / 41.9 ms.
The pan result still exceeds a 16.7 ms frame interval; these checks do not
promise 60 FPS for every board or device. The artifact retains both scheduling
traces and identifies them separately from GPU timings. The input board is
unchanged, and its content is not included in the checked-in evidence.

The service-worker cache version advances from v7 to v8 so an activated worker
does not keep serving the previous coverage atlas under the same asset URL.
The generated atlas URL also includes a content digest, allowing the new atlas
to load while an older service worker still controls an open application.

To reproduce against the previous coverage-tile renderer, run:

```sh
node scripts/serve-text-motion.mjs \
  --board /absolute/path/to/boardTest.bf \
  --baseline 2c11cd0031b7bd565802afed0111d033db3d5125 \
  --port 5193 \
  --evidence /tmp/boardfish-zoom
```

Open the [full board](http://127.0.0.1:5193/actual-board.html), select **Open
fixture board**, and use **Next textbox** to reach a large textbox. **Zoom
sweep** exercises the regular app viewport path. After `npm run web:build`, the
[production-board page](http://127.0.0.1:5193/production-board.html) runs the same
fixture against the built application.

For renderer timing, open the [full-size
comparison](http://127.0.0.1:5193/dev/board-motion-benchmark.html?baseline=1&width=1200&height=800),
select DPR 2, and click **Measure zoom**. A browser viewport of 2,500 × 1,200 CSS
pixels accommodates both panels; verify that the exported visibility records
report both panels fully visible and the document visible. The benchmark
performs four blocks in previous/current/current/previous order. Each block
zooms logarithmically from 10% to 100% over 120 frames and back over 120 frames,
for 480 measured frames per renderer. Each renderer's first block clears its
text caches; its repeated block preserves them. Both use the same warmed
current layout implementation and live viewport selection, so renderer timing
does not replace the separate before/after layout measurement.

GPU time comes from asynchronous `EXT_disjoint_timer_query_webgl2` queries.
Unavailable, disjoint, or unresolved samples are reported explicitly. CPU time
covers layout selection and draw submission; rAF intervals additionally include
browser scheduling. Pixel readback and PNG generation happen outside timed
blocks. Per-frame JSON retains zoom, glyph submissions, draw counts, cache
activity, CPU time, GPU time, and rAF intervals.

Use the [default-size
comparison](http://127.0.0.1:5193/dev/board-motion-benchmark.html?baseline=1) for
**Verify pixels** and **Run all**. Verify pixels performs eight comparisons at
each of 14 zooms for the selected DPR. Run all performs the 14 phase and pan
configurations described above. The previous renderer loads its own metadata
and atlas from the selected Git revision; a coverage-capable baseline is not
allowed to silently use the current font atlas.

The isolated layout benchmark is available at
[text-layout-zoom-benchmark.html](http://127.0.0.1:5193/dev/text-layout-zoom-benchmark.html).
Add [baseline=1](http://127.0.0.1:5193/dev/text-layout-zoom-benchmark.html?baseline=1)
for the previous layout source. Both pages use the same fixture and loaded font.
Preserve each exported JSON before the next run overwrites the local evidence
endpoint.
