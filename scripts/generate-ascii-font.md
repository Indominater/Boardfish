# Generate the ASCII font atlas

`src/fonts/geist-ascii-msdf.png` and its JSON metadata are generated from the
existing `src/fonts/Geist.woff2` (Geist 1.401, weight 400). They cover U+0020–U+007E:
space has advance metadata, and the other 94 characters have drawable quads.
Generation tools are optional developer dependencies, never browser dependencies.
The source font and generated atlas are covered by `src/fonts/geist-ascii-OFL.txt`.

## Reproduce

Use [MSDF Atlas Gen v1.4](https://github.com/Chlumsky/msdf-atlas-gen/tree/v1.4),
commit `2ede254314a2512252a225fa6c975948d6af559a`, with its pinned
[MSDFgen](https://github.com/Chlumsky/msdfgen) submodule
`1874bcf7d9624ccc85b4bc9a85d78116f690f35b` (v1.13.0). Build with CMake, a C++
compiler, FreeType, and libpng. Skia, SVG import, and Artery Font export are unused.
Keep the build and Python environment outside this repository:

```sh
git clone --branch v1.4 --recurse-submodules https://github.com/Chlumsky/msdf-atlas-gen.git /tmp/boardfish-msdf-atlas-gen
cmake -S /tmp/boardfish-msdf-atlas-gen -B /tmp/boardfish-msdf-build \
  -DCMAKE_BUILD_TYPE=Release -DMSDF_ATLAS_USE_VCPKG=OFF \
  -DMSDF_ATLAS_USE_SKIA=OFF -DMSDF_ATLAS_NO_ARTERY_FONT=ON
cmake --build /tmp/boardfish-msdf-build --parallel
python3 -m venv /tmp/boardfish-fonttools-venv
/tmp/boardfish-fonttools-venv/bin/python -m pip install fonttools==4.59.1 brotli==1.1.0
/tmp/boardfish-fonttools-venv/bin/python scripts/generate-ascii-font.py \
  --generator /tmp/boardfish-msdf-build/bin/msdf-atlas-gen
```

[FontTools](https://github.com/fonttools/fonttools) and
[Brotli](https://github.com/google/brotli) decode WOFF2 into a temporary TrueType
file without changing its outlines; the generator explicitly selects `wght=400`.
The script rejects an unexpected source font hash or tool version. Its output
contains source and tool provenance. Add `--check` to regenerate into a temporary
directory, validate the glyphs/bounds/PNG, and compare both committed files byte
for byte. Different compiler or FreeType/libpng versions can change distance-field
rounding or PNG compression; review differences instead of silently replacing the
assets. The original generation used Apple Clang 21.0.0, FreeType 2.14.3, and libpng
1.6.58 on macOS arm64.

For macOS with Homebrew FreeType/libpng and Clang but no CMake, the same source
can be built from `/tmp/boardfish-msdf-atlas-gen` with:

```sh
clang++ -std=c++17 -O2 -pthread \
  -DMSDFGEN_USE_CPP11 -DMSDFGEN_DISABLE_SVG -DMSDFGEN_USE_LIBPNG \
  -DMSDFGEN_PUBLIC= -DMSDFGEN_EXT_PUBLIC= -DMSDF_ATLAS_PUBLIC= \
  -DMSDF_ATLAS_NO_ARTERY_FONT -DMSDF_ATLAS_STANDALONE \
  -DMSDF_ATLAS_VERSION=1.4.0 -DMSDFGEN_VERSION=1.13.0 \
  -DMSDF_ATLAS_COPYRIGHT_YEAR=2025 \
  -Imsdfgen -I/opt/homebrew/opt/freetype/include/freetype2 \
  -I/opt/homebrew/opt/libpng/include \
  -L/opt/homebrew/opt/freetype/lib -L/opt/homebrew/opt/libpng/lib \
  msdfgen/core/*.cpp msdfgen/ext/*.cpp msdf-atlas-gen/*.cpp \
  -lfreetype -lpng -o /tmp/boardfish-msdf-atlas-gen/msdf-atlas-gen-bin
```

## Runtime contract

The atlas is a 512 × 512 RGB PNG at 64 pixels per em with an 8-pixel distance
range. Treat RGB as linear distance data, disable image color conversion when
uploading, and use linear texture filtering. MSDFgen's
[shader example](https://github.com/Chlumsky/msdfgen#using-a-multi-channel-distance-field)
reconstructs coverage from the median RGB distance and the screen-space pixel
range. This preserves corners as glyphs scale; it does not reproduce browser
font hinting or native text antialiasing exactly.

The native JSON schema is preserved:

- `atlas`: dimensions, `size` (pixels per em), `distanceRange`, `yOrigin: "bottom"`.
- `glyphs`: `unicode`, `advance`, `planeBounds` in em relative to the baseline,
  and `atlasBounds` in texture pixels. Space omits both bounds.
- `metrics`: font-wide em measurements. `source` and `generator`: provenance.

Multiply `planeBounds` by the runtime font size and add each character's existing
layout prefix position. The app's layout remains authoritative for advance,
wrapping, spacing, tabs, and caret geometry; atlas advances do not replace it.
For a canvas baseline `y`, the quad top is `y - planeBounds.top * fontSize`.
With an unflipped top-down PNG upload, convert texture Y using
`v = 1 - atlasY / atlas.height`. Use padding already included in these bounds;
do not crop glyphs to their zero-distance contour.
