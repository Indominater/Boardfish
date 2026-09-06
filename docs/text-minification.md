# Stable text at low zoom

Textboxes now integrate the ink covered by each physical display pixel when text
is very small. The renderer shares one immutable summed-area font atlas across
every textbox and accumulates neighboring glyph coverage before compositing the
text. Fractional panning therefore preserves tiny stems and punctuation instead
of repeatedly losing them between pixel centers. Readable text retains the MSDF
renderer and existing layout positions.

## Why the old renderer flickered

At 10% zoom, a 16-world-pixel font occupies 1.6 physical pixels per em at DPR 1,
or 3.2 at DPR 2. A glyph's padded triangle quad can become narrower than a pixel.
If it misses every pixel center, its fragment shader never runs. More sampling
inside that shader cannot recover the missing glyph. Repeated characters sharing
a baseline can disappear together, making entire lines pulse during panning.

The previous four MSDF samples also undersampled the many contours within a
single physical pixel. Changing fractional camera position changed the apparent
amount of ink. Increasing the samples alone would add recurring work for every
visible glyph without fixing the rasterized quad's coverage.

There was a separate whole-textbox transition for mixed ASCII/Unicode content.
GPU eligibility depended on the currently visible rows. A Unicode row entering
or leaving the viewport could switch all other visible rows between GPU and
compatibility rendering. Eligibility now checks the complete textbox content
and caches that decision until the content changes.

## Pixel-area coverage

`scripts/generate-text-integral.py` derives the new font data from the checked-in
96-pixels-per-em Geist MSDF and its metrics. It reconstructs the linear MSDF
contours with eight by eight subpixel samples per coverage cell, at 32 cells per
em. Each glyph occupies a 64 by 64 coverage grid spanning two em in each axis.
The grid includes a transparent border, and every coverage cell is quantized to
an unsigned byte. This is shared font data; no textbox is rasterized into it.

The generator computes each grid's prefix sums, producing a 65 by 65 summed-area
table with a zero first row and column. The 96 tiles for ASCII 32 through 127 are
packed into a 1040 by 390 PNG. Each prefix value is an unsigned 24-bit integer
stored in RGB, high byte first. The metadata records the source image and metrics
checksums. Space and DEL tiles are blank.

For an axis-aligned physical pixel whose glyph-local footprint runs from
`(left, top)` to `(right, bottom)`, the covered ink is:

```text
I(right, bottom) - I(left, bottom) - I(right, top) + I(left, top)
```

Dividing by the footprint area gives the pixel's alpha coverage. Bilinear
interpolation of the integral handles partial coverage cells; clamping each
lookup to its own tile handles the transparent area beyond the glyph. This
integrates the complete footprint using four integral lookups regardless of how
many contours the pixel covers. It is an exact area filter for the generated,
quantized coverage grid in exact arithmetic, rather than an exact evaluation of
the original vector font.

At startup, devices supporting `OES_texture_float_linear` decode the small PNG
once into an `R32F` integral texture. Other devices retain its packed bytes and
decode four `texelFetch` samples before manually interpolating each integral
lookup. Direct hardware interpolation of packed RGB bytes is avoided because
texture-unit rounding can be magnified by the high byte. The portable path uses
16 texel fetches per output pixel; the float path uses four filtered lookups.
Neither path uploads or reads back font data while panning or zooming.

Glyph quads expand by half a physical pixel on each edge while using area
filtering. This ensures every pixel whose footprint intersects the glyph can
run the fragment shader. The expanded quad interpolates the corresponding
glyph-local coordinates; glyph positions and layout metrics do not move.

## Accumulation and readable text

Each textbox first adds its glyph coverage into one reusable canvas-sized mask.
Independent source-over blending of minified glyphs would produce `a + b - a*b`
where disjoint strokes within the same pixel should contribute `a + b`. That
would reintroduce camera-dependent ink loss even with correct individual glyph
areas. Accumulating first and compositing once preserves the combined coverage.

The mask uses `R16F` when float framebuffer support is available, avoiding an
8-bit rounding step after every glyph. Devices without that support use `R8`.
Only the textbox's conservative visible rectangle is cleared and composited.
The final pass clamps accumulated coverage and applies the existing text color
and opacity over the ordered scene. The target is allocated lazily, reused
between textboxes and frames, and recreated after a canvas resize or context
restoration. It does not retain viewport snapshots or textbox bitmaps.

Below eight physical pixels per em, the shader uses area coverage. Between eight
and twelve, it smoothly blends area coverage into the existing MSDF treatment.
At twelve and above, MSDF rendering is unchanged: four samples below 24, a smooth
transition to one sample through 32, and the higher-resolution font resource at
128 pixels per em. Rotated or sheared transforms retain MSDF because a
rectangular integral is not an exact rotated pixel footprint. Sampling choices
depend on scale and capabilities, with no motion/idle quality switch.

## Retained work and memory

The renderer continues to retain glyph instances in 64-row chunks. It now keeps
one CPU instance array alongside each GPU buffer. When panning reveals a few
new rows, unchanged row data is copied with typed-array operations while only
new or changed rows are decoded from characters and layout positions. A changed
chunk is uploaded once; already prepared views require no geometry upload.
Wrapping, spacing, selection, and carets still use the existing layout engine.

The memory costs are explicit:

| Resource | Cost |
| --- | --- |
| Integral PNG | 47,608 compressed bytes |
| Integral GPU texture | 1,622,400 bytes, approximately 1.55 MiB, for `R32F` or packed `RGBA8` |
| Shared coverage mask | Two bytes per physical canvas pixel for `R16F`; one for `R8` |
| Retained CPU glyph copy | Matches resident GPU instance bytes, bounded by the existing 64 MiB glyph-buffer limit |

The two MSDF textures remain resident for readable and enlarged text. Replacing
a changed chunk briefly holds its old and replacement CPU arrays; the new
allocation is checked against the geometry budget first. Arrays are released
with their chunk. No allocation scales with the full board's pixel dimensions.

## Browser measurements

Chrome 152 on macOS, September 6, 2026 at 20:58 UTC. Both mounted comparison
panels were fully visible in a foreground tab at 400 by 256 CSS pixels. Actual
browser DPR was approximately 1.11; the benchmark explicitly used backing-store
DPR 1 and 2. Native PNG exports were used for physical-pixel inspection.

Phase sweeps moved eight isolated lines of repeated characters (`.`, `_`, `-`,
`i`, `|`, `H`, `e`, `A`) through 64 positions along each axis spanning almost one
physical pixel. Every line remained inside the viewport. Brightness is the
integrated foreground contribution across the whole row. Variation is
`100 * (maximum - minimum) / mean`; the table reports the worst row/axis for each
configuration. Zero samples count completely lost rows across all eight glyphs,
both axes, and all 64 positions, totaling 1,024 row-phase samples per renderer
per configuration.

| Zoom / DPR | Worst brightness variation, previous → current | Zero row-phase samples, previous → current |
| --- | ---: | ---: |
| 10% / 1 | 285.6314% → 3.9788% | 145 → 0 |
| 12.5% / 1 | 199.6159% → 2.2187% | 31 → 0 |
| 10% / 2 | 33.0279% → 1.2629% | 0 → 0 |
| 12.5% / 2 | 37.5207% → 1.1023% | 0 → 0 |

Dense panning used three textboxes containing exactly 100,000 characters each,
with 3,500-world-pixel widths. Each frame selected visible objects and requested
live viewport layout while the camera crossed rows and chunk boundaries. Four
60-frame blocks alternated previous/current/current/previous, with 12 warmup
frames per block and independent layout objects for each renderer. Pixel
readback and PNG capture occurred outside timed blocks.

| Zoom / DPR | CPU p50, previous → current | CPU p95, previous → current | CPU mean, previous → current |
| --- | ---: | ---: | ---: |
| 10% / 1 | 0.5 → 0.3 ms | 2.1 → 0.9 ms | 0.8217 → 0.3417 ms |
| 12.5% / 1 | 0.4 → 0.5 ms | 2.0 → 1.1 ms | 0.6508 → 0.6233 ms |
| 10% / 2 | 0.2 → 0.6 ms | 2.1 → 1.1 ms | 0.7575 → 0.6658 ms |
| 12.5% / 2 | 0.5 → 0.4 ms | 2.2 → 0.8 ms | 0.8833 → 0.3825 ms |

CPU submission includes viewport layout and WebGL command submission. The
current renderer lowered p95 and mean submission time in all four measured
configurations; two medians increased. Warm repeated blocks recorded zero
uploads. RequestAnimationFrame median intervals remained approximately 16.7 ms
for both renderers, with no interval above 25 ms and an overall maximum of
17.7 ms. These are scheduling and CPU-submission measurements, not GPU execution
times or proof of a universal frame-rate improvement.

The [measurement summary JSON](gpu-render-results/text-minification.json)
preserves these aggregate results and their limits. It is a summary, without
the raw per-frame or per-phase samples downloadable from a fresh benchmark run.

The built production app also opened a `.bf` fixture containing three
100,000-character textboxes at 10% zoom. Panning and scrolling in the light theme
produced no observed errors. Separate precision checks at zoom scales 0.1,
0.18, 0.25, 0.5, 1, 1.25, 1.75, 2, 4, and 10 produced identical pixels at the
world origin and at `(10,000,000, 10,000,000)` with a compensating camera
transform, with zero geometry uploads for that movement. Native 16, 20, and
28-pixels-per-em text remained visually sharp.

A forced context loss/restoration at 10% zoom rebuilt the fonts and coverage
resources and reproduced the same 534 ink pixels and checksum `f5b5d1ed`.
Continuous zoom visited 180 scales from 0.18 through 4; rendering the same
1.371927 scale during motion and at rest produced the identical checksum
`f78319c3`. Upload counters were not recorded for that continuous-zoom run.

A browser phase sweep also forced the portable capability path at 10% zoom and
DPR 1 by disabling `EXT_color_buffer_float` and `OES_texture_float_linear`.
The `R8` mask and manually interpolated packed atlas retained every row, with no
observed errors. Worst brightness variation was 12.6799%, compared with
285.6314% for the previous renderer and 3.9788% for the default float path.
The portable path has lower accumulation precision; no portable-path timing
measurement was recorded. The final full check passed 569 tests and the separate
25-test static run, including JavaScript syntax and production source checks.

The browser still presents an 8-bit image, and coverage generation, texture
interpolation, float accumulation, and output conversion have finite precision.
The measured residual variation is therefore reported rather than described as
zero aliasing. The run demonstrates removal of disappearing rows and a large
reduction in brightness pulses on the tested browser and device. Other GPUs,
fallback capability paths, browser engines, and operating systems can differ.

## Reproduce and verify

Run from the repository root:

```sh
npm run web:dev
```

Open `http://127.0.0.1:5173/dev/text-minification-benchmark.html` using the port
reported by the server, keep both panels fully visible, and select **Run all**.
Download the JSON report and native PNGs. **Animate panning** shows the live
three-textbox workload. The JSON identifies capabilities, visibility, per-phase
brightness, timing samples, and resource deltas.

The default benchmark uses the current renderer in both panels and explicitly
marks the previous implementation as unavailable. The optional comparison file
`src/dev/gpu-text-before.js` is not shipped. To reproduce the recorded comparison,
extract the verified earlier renderer revision:

```sh
git show 07aa2fa:src/js/gpu_renderer.js > src/dev/gpu-text-before.js
```

Then open `/dev/text-minification-benchmark.html?baseline=1`. The page captures
the prior exported API before loading the current renderer; no source renaming
is required. For future renderer changes, save a copy of the old
`src/js/gpu_renderer.js` to that comparison file **before applying the change**.
Saving the already updated renderer only compares it to itself. The report's
`baselineAvailable` field must be true for an actual previous/current comparison.
To exercise the portable path in the browser, use
`/dev/text-minification-benchmark.html?baseline=1&portable=1`, select 10% and
DPR 1, and run **Measure subpixel phases**. This test-only option overrides the
two float capability extensions, selecting manual packed-atlas interpolation
and the `R8` coverage target.

Verify the actual atlas bytes and mathematical invariants with:

```sh
node --test test/text_integral_atlas.test.js
python3 scripts/generate-text-integral.py --check
```

The generator requires NumPy and Pillow. It rebuilds the atlas, verifies packed
prefix interpolation and translated pixel footprints, and compares generated
files byte-for-byte without writing. Omit `--check` to regenerate the assets.
The Node tests independently decode the PNG, check source hashes, coverage-cell
bounds and transparent borders, verify glyph ink conservation, and exercise
startup/offline asset registration. Run `npm run check` for the complete suite.
