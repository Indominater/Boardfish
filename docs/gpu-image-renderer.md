# Retained image resolution levels

The initial GPU compositor uploaded image tiles at the selected source's native
resolution. The existing CPU image selector switches between quarter-size and
full-size bitmaps, increasing the source pixel count sixteenfold at its boundary.
The boundary depends on image dimensions, object dimensions, DPR and the existing
active-input allowance; it is not a fixed 70% application setting.

Large native-resolution working sets exceeded the compositor's 128 MiB cache.
Rendering then repeatedly copied missing tiles through Canvas2D, uploaded them,
and evicted tiles required by the next frame. An 8192×8192 image displayed at
2048×2048 reproduced 16 uploads every frame, even with a one-pixel pan.

## Structural change

`src/js/gpu_renderer.js` now retains power-of-two image resolution levels. The
selected level provides at least one texel per device pixel during minification,
up to the source's native resolution. Immediately above the quarter-source
boundary, the full source usually needs only a half-resolution GPU representation:
one quarter of the previous texture bytes.

The transformed source-to-destination mapping determines the level. Its largest
singular value accounts for rotation, flipping, nonuniform scaling and shear.
Camera position and viewport crop do not change a level's fixed tile grid.
Rounded level dimensions preserve complete odd-sized images and crop endpoints.

Each level uses tiles of at most 2048 content pixels, plus sampling gutters.
Downsampling draws the whole source on a shared grid into the clipped tile canvas,
so filtering can read across tile boundaries. Immutable sources reuse these
textures; mutable canvas/video sources refresh their pixels. Nearest-neighbor
drawing retains the native source. Context restoration, source replacement,
reset and memory eviction release the corresponding levels.

This changes image storage and sampling, with the same resolution rule during
motion and at rest. It adds no delayed rendering or new viewport culling. The
first visit to an uncached level still builds/uploads it synchronously. Working
sets larger than the cache can still cause eviction; this reduces their demand
rather than raising the memory cap. The text renderer is unchanged.

## Browser measurements

Local Chrome 152, Apple M2, ANGLE Metal, configured canvas DPR 2. Three mounted
340×224 CSS-pixel panels use the actual `BoardfishRenderer.drawSingleObj` viewport
crop and edge-overdraw path. Immutable full and quarter-size ImageBitmaps are
prepared before timing. Dimensions place the source boundary at 70.71% for this
fixture. Each renderer warms both source choices and then draws 90 measured
frames in two blocks with renderer order reversed. No readback or GPU fence is
inside measured frames.

| Workload | Previous GPU CPU median / p95 | Updated GPU CPU median / p95 | Previous → updated image uploads after warm-up |
| --- | --- | --- | --- |
| 3 × 2048×1536, pan at 72% | 0.2 / 0.4 ms | 0.3 / 0.4 ms | 0 → 0 |
| 3 × 2048×1536, alternate 68% / 72% | 0.3 / 0.4 ms | 0.2 / 0.4 ms | 0 → 0 |
| 6 × 4096×3072, pan at 72% | 1.5 / 2.0 ms | 0.2 / 0.4 ms | 1,980 → 0 |
| 6 × 4096×3072, alternate 68% / 72% | 1.0 / 2.0 ms | 0.2 / 0.4 ms | 1,260 → 0 |

The large pan case's median/p95 rAF interval fell from 66.7/83.4 ms to
16.7/16.8 ms. The large boundary case's p95 fell from 83.3 to 16.7 ms; both medians
were 16.7 ms. Three intervals over 25 ms remained in the updated pan run and one
in the updated boundary run. These are synthetic local comparisons, not timing
measurements of a user's saved board or guarantees for other hardware.

Native-density controls for both image counts had identical previous/updated GPU
CPU median/p95 (0.2/0.4 ms), 16.7 ms median rAF intervals and zero warm uploads.
Canvas2D controls stayed around 0.2–0.3 ms median CPU and 16.7 ms median rAF.

The large boundary fixture retains 90 MiB in the updated renderer. The isolated
8192px regression now retains one 16 MiB texture and uploads nothing while panning
after its first draw.

## Correctness and reproduction

Seven additional unit regressions cover warm reuse, source transitions, stable
crop/tile mapping, odd dimensions, transformed detail, mutable sources and resource
lifecycle. `npm run check` passes 557 tests plus the separate 25-test static run;
the production web build also passes.

Native PNGs were inspected for cropped, rotated, flipped and translucent images.
The modest case is pixel-identical to the previous GPU path. The larger case uses
the new downsampled level and differs slightly from Canvas2D's direct resampling
(0.955 average absolute RGB-channel difference on a 0–255 scale); the filters are
not expected to produce identical pixels.

An 8193×2049 source downsampled to 4097×1025 was compared with an explicitly resized
whole-image reference. At four fractional pan phases, the six-pixel band around
the tile seam matched exactly. Away from the seam, maximum channel differences
were at most two.

Run `npm run web:dev` and open `/dev/gpu-image-benchmark.html`. The page exposes
`BoardfishGpuImageBenchmark.run({workload:'pressure', motion:'boundary', dpr:2})`,
`checkPixels({workload:'pressure', dpr:2})` and `checkSeams()`.
To include the original GPU baseline, create the temporary comparison file with
`git show 5841044:src/js/gpu_renderer.js > src/dev/gpu-image-renderer-before.js`, open
the page with `?baseline=1`, and delete that temporary file after comparison.

Raw measurements and native images are in `docs/gpu-render-results/images-*`;
the seam previews are `boardfish-odd-source-*.png` in the same directory.
