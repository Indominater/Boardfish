# ASCII font atlas

Boardfish ships two precomputed multi-channel signed distance fields (MSDF) for the
94 printable, non-space ASCII characters in its existing Geist font. This is
font data, not pre-rendered text lines: every textbox shares the same two resources
at every zoom level. There is no runtime font conversion, atlas generation, or
network dependency.

## Files and provenance

- `src/fonts/Geist.woff2`: unchanged source, Geist 1.401, weight axis fixed to 400.
- `src/fonts/geist-ascii-msdf.png`: RGB distance data, 868 × 868, 270,608 bytes.
- `src/fonts/geist-ascii-large-msdf.png`: precise large-text RGB distance data,
  1108 × 1108, 294,805 bytes.
- `src/fonts/geist-ascii-msdf.js`: global `BoardfishAsciiFont`, indexed ASCII
  bounds and advances. This is loaded before the GPU text renderer.
- `src/fonts/geist-ascii-LICENSE.txt`: Geist's SIL Open Font License 1.1.
- `scripts/generate-text-atlas.py`: deterministic conversion and validation.

Source WOFF2 SHA-256:
`5eb88b972cad22bd9937079e8e8c7fd9fae22dd8e621ea23c2e733bb3e8c2ee5`.
The script stops if the source changes, requiring an explicit font review.

The generator is [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen),
version 1.4.0, revision `2ede254314a2512252a225fa6c975948d6af559a`, with
[msdfgen](https://github.com/Chlumsky/msdfgen) 1.13.0 at
`1874bcf7d9624ccc85b4bc9a85d78116f690f35b`. Both generators use the MIT
license; their executable and sources are build tools and are not bundled in
the application. The font copyright and license are carried with the output.

## Reproduce

The checked-in files were generated with Python 3.12, fonttools 4.59.1, Brotli
1.1.0, FreeType 2.14.3, libpng 1.6.58, and the pinned generator above on macOS
arm64. A C++ compiler, CMake, FreeType development files, and libpng development
files are required to build the generator. For example, from a temporary build
directory:

```sh
git clone https://github.com/Chlumsky/msdf-atlas-gen.git
git -C msdf-atlas-gen checkout 2ede254314a2512252a225fa6c975948d6af559a
git -C msdf-atlas-gen submodule update --init --recursive
cmake -S msdf-atlas-gen -B msdf-atlas-gen/build \
  -DCMAKE_BUILD_TYPE=Release -DMSDF_ATLAS_USE_VCPKG=OFF \
  -DMSDF_ATLAS_USE_SKIA=OFF -DMSDF_ATLAS_NO_ARTERY_FONT=ON
cmake --build msdf-atlas-gen/build --parallel
python3 -m venv font-build-env
font-build-env/bin/python -m pip install 'fonttools[woff]==4.59.1' 'brotli==1.1.0'
```

From the Boardfish repository, run the script with those tool paths:

```sh
/path/to/font-build-env/bin/python scripts/generate-text-atlas.py \
  --generator /path/to/msdf-atlas-gen/build/bin/msdf-atlas-gen
```

The script instantiates the bundled variable font, emits a temporary uncompressed
TTF, generates the two MSDF resources below, and removes temporary files.
Geometry is unhinted; no OS-dependent raster masks are
baked in. It fixes the coloring seed and uses one generation thread. It verifies
all 95 character entries, empty space geometry, bounds, the em-to-atlas scale,
and PNG dimensions before updating the checked-in assets. Both resources must
have identical font metrics and advances.

| Resource | Atlas pixels per em | Distance range in atlas pixels | Purpose |
| --- | ---: | ---: | --- |
| Main | 96 | 32 | Enough distance and padding for small text and coverage integration |
| Large | 192 | 4 | More precise contours at high magnification |

Both resources are uploaded at initialization. The renderer selects a resource
using the physical pixel size of the text (the large resource starts at 128
pixels per em); selection never depends on motion or idle time. Glyph instance
buffers and authoritative text layout are shared. At 100× zoom and DPR 2,
the large atlas's 8-bit distance quantization step is approximately
`4 / 192 / 255 * 3200 = 0.2614` screen pixels, compared with `4.183` pixels
for the wide-range atlas. Rounding contributes up to half a quantization step;
this bound does not include curve approximation or interpolation error.

Two consecutive generations produced identical files:

| File | SHA-256 |
| --- | --- |
| `geist-ascii-msdf.png` | `f6b73dc64ca44647e87c560d66be4b05c0ad15763e6a16e012c05da80b4a67b5` |
| `geist-ascii-large-msdf.png` | `4dd26f50d3f300d88d3496d755e5288e4bcf6d6c17e4e7f05d4d3204213beae5` |
| `geist-ascii-msdf.js` | `1db27be65b8c39672e7b61319e7bf15fef9cfcab2a357b2d38a413a874f91db3` |

Other compiler or dependency versions can change compressed bytes or floating
point rounding, so compare glyph geometry and rendered output when intentionally
upgrading a build dependency.

## Runtime contract

`BoardfishAsciiFont.glyphs` has 128 slots, indexed by ASCII code. Slots 0–31 and
127 are null; newline/tab layout remains the layout engine's responsibility.
Slot 32 has an advance but no ink geometry. Slots 33–126 contain:

```js
{
  advance: 0.5, // em, informational; existing layout owns text positions
  planeBounds: { left, bottom, right, top }, // em relative to alphabetic baseline
  atlasBounds: { left, bottom, right, top }  // atlas pixels from bottom-left
}
```

`BoardfishAsciiFont.largeFont` has the same schema, its own image dimensions and
glyph bounds, and no further nested font. Its distance range is 4 and atlas em
size is 192; always use the active resource's bounds and distance range together.

Both bounds use positive Y upward. Canvas/world coordinates use positive Y
downward, so negate plane Y relative to the existing baseline. Atlas coordinates
refer to image pixel centers where appropriate and are normalized by the atlas
width and height for texture sampling. For bottom-origin UVs, upload image data
with `UNPACK_FLIP_Y_WEBGL` enabled. Glyph quads include their distance padding;
do not replace these bounds with font ink bounds.

The PNG's RGB values represent **linear distance data**, not display colors.
Disable unpack color-space conversion, use an ordinary RGB8/RGBA8 texture, and
sample with linear filtering without sRGB decoding. Reconstruct distance with
the median of RGB and convert it to coverage using the screen-space derivative
and the declared `distanceRange: 32`. This wider range retains more than one
screen pixel of distance information even at four physical pixels per em
(25% zoom at DPR 1), and provides padding for subpixel coverage integration.
MSDF preserves glyph contours and corners
across scale; it does not itself supply small-size grid hinting or ClearType.
The renderer's coverage treatment must be evaluated at the final device pixel
size.

The metadata's advances are not a replacement for Boardfish's current spacing
rules. The renderer consumes the layout engine's positions, preserving custom
ink gaps, tab stops, wrapping, caret locations, and selection ranges.
