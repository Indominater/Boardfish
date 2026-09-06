#!/usr/bin/env python3
"""Build an immutable area-coverage atlas from Boardfish's checked-in MSDF.

Build-time dependencies: NumPy and Pillow. No font rasterizer, network access,
or runtime text rendering is involved. Run with --check to verify that the
checked-in assets reproduce and that filtered glyph ink is translation-invariant.

Each 64 x 64 coverage tile samples two em at 32 cells/em. Its 65 x 65 summed-area
table contains a zero first row/column and unsigned 24-bit prefixes in big-endian
RGB. Linear texture filtering followed by a linear RGB decode gives the bilinear
integral. Four samples therefore integrate a destination pixel's complete
footprint, including partial cells and transparent space outside the glyph.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FONT_DIRECTORY = ROOT / "src" / "fonts"
SOURCE_IMAGE = FONT_DIRECTORY / "geist-ascii-msdf.png"
SOURCE_METRICS = FONT_DIRECTORY / "geist-ascii-msdf.js"
OUTPUT_IMAGE = FONT_DIRECTORY / "geist-ascii-integral.png"
OUTPUT_METRICS = FONT_DIRECTORY / "geist-ascii-integral.js"

EM_SIZE = 32
CELLS = 64
CELL_SIZE = CELLS + 1
COLUMNS = 16
ROWS = 6
ORIGIN_X = -0.5
ORIGIN_Y = -1.25
SUBSAMPLES = 8
COVERAGE_SCALE = 255
WEIGHTS = np.array([65536, 256, 1], dtype=np.float64)


def source_description() -> tuple[dict, bytes, bytes]:
    metrics_bytes = SOURCE_METRICS.read_bytes()
    image_bytes = SOURCE_IMAGE.read_bytes()
    prefix = "globalThis.BoardfishAsciiFont = "
    source = metrics_bytes.decode("utf-8").partition(prefix)[2].strip()
    if not source.endswith(";"):
        raise ValueError("Expected generated BoardfishAsciiFont JSON assignment")
    description = json.loads(source[:-1])
    if description["type"] != "msdf" or description["emSize"] != 96:
        raise ValueError("Expected the existing 96 pixels/em ASCII MSDF")
    return description, image_bytes, metrics_bytes


def bilinear(values: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Sample values whose centers have integer coordinates, clamped at edges."""
    x = np.clip(x, 0, values.shape[1] - 1)
    y = np.clip(y, 0, values.shape[0] - 1)
    ix = np.floor(x).astype(np.int32)
    iy = np.floor(y).astype(np.int32)
    nx = np.minimum(ix + 1, values.shape[1] - 1)
    ny = np.minimum(iy + 1, values.shape[0] - 1)
    fx, fy = x - ix, y - iy
    if values.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    top = values[iy, ix] * (1 - fx) + values[iy, nx] * fx
    bottom = values[ny, ix] * (1 - fx) + values[ny, nx] * fx
    return top * (1 - fy) + bottom * fy


def glyph_coverage(image: np.ndarray, font: dict, glyph: dict) -> np.ndarray:
    """Integrate linearly reconstructed MSDF contours over each coverage cell."""
    plane, atlas = glyph["planeBounds"], glyph["atlasBounds"]
    if not (ORIGIN_X < plane["left"] < plane["right"] < ORIGIN_X + CELLS / EM_SIZE
            and ORIGIN_Y < -plane["top"] < -plane["bottom"] < ORIGIN_Y + CELLS / EM_SIZE):
        raise ValueError("A glyph exceeds the fixed integral tile")

    subpixel = (np.arange(CELLS * SUBSAMPLES, dtype=np.float64) + 0.5) / (EM_SIZE * SUBSAMPLES)
    x, y = np.meshgrid(ORIGIN_X + subpixel, ORIGIN_Y + subpixel)
    # MSDF atlas bounds are texel centers in a bottom-origin coordinate system;
    # Pillow and the integral atlas both use top-origin image coordinates.
    atlas_x = atlas["left"] + (x - plane["left"]) * (
        (atlas["right"] - atlas["left"]) / (plane["right"] - plane["left"]))
    atlas_y = font["height"] - atlas["top"] + (y + plane["top"]) * (
        (atlas["top"] - atlas["bottom"]) / (plane["top"] - plane["bottom"]))
    atlas_x = np.clip(atlas_x, atlas["left"], atlas["right"])
    atlas_y = np.clip(atlas_y, font["height"] - atlas["top"], font["height"] - atlas["bottom"])
    distance = np.median(bilinear(image, atlas_x - 0.5, atlas_y - 0.5), axis=2) / 255 - 0.5
    # Antialias each fine sample at its actual density before integrating its
    # area; this avoids baking a binary sampling phase into the low-res cells.
    sample_range = font["distanceRange"] * EM_SIZE * SUBSAMPLES / font["emSize"]
    alpha = np.clip(distance * sample_range + 0.5, 0, 1)
    inside = ((x >= plane["left"]) & (x <= plane["right"])
              & (y >= -plane["top"]) & (y <= -plane["bottom"]))
    alpha *= inside
    cells = alpha.reshape(CELLS, SUBSAMPLES, CELLS, SUBSAMPLES).mean(axis=(1, 3))
    coverage = np.floor(cells * COVERAGE_SCALE + 0.5).astype(np.uint32)
    if np.any(coverage[0]) or np.any(coverage[-1]) or np.any(coverage[:, 0]) or np.any(coverage[:, -1]):
        raise ValueError("Integral tile has insufficient transparent border")
    return coverage


def pack(prefix: np.ndarray) -> np.ndarray:
    if int(prefix.max()) >= 1 << 24:
        raise ValueError("Coverage prefix exceeds RGB24")
    return np.stack((prefix >> 16, (prefix >> 8) & 255, prefix & 255), axis=2).astype(np.uint8)


def verify_integral(prefix: np.ndarray, packed: np.ndarray) -> None:
    """Check packing and continuous pixel-footprint integration for this glyph."""
    if not np.array_equal(packed.astype(np.uint32) @ WEIGHTS.astype(np.uint32), prefix):
        raise AssertionError("RGB24 round trip failed")
    random = np.random.default_rng(51438)
    x, y = random.uniform(-8, CELLS + 8, (2, 128))
    decoded_filter = bilinear(packed, x, y) @ WEIGHTS
    reference_filter = bilinear(prefix, x, y)
    if not np.allclose(decoded_filter, reference_filter, rtol=0, atol=1e-8):
        raise AssertionError("Packed RGB linear filtering changed the integral")
    # Independent per-glyph ink must be invariant when the destination's pixel
    # grid translates. This checks full footprint integration, including every
    # edge, at 10% zoom for DPR 1/2 and across the MSDF transition region.
    for device_em in (1.6, 3.2, 6.4, 10.0):
        footprint = EM_SIZE / device_em
        expected = float(prefix[-1, -1]) / (footprint * footprint)
        pixels = np.arange(-2, int(np.ceil(CELLS / footprint)) + 3)
        for phase_x in (0.0, 0.125, 0.5, 0.875):
            for phase_y in (0.0, 0.2, 0.5, 0.9):
                left, top = np.meshgrid((pixels - phase_x) * footprint, (pixels - phase_y) * footprint)
                right, bottom = left + footprint, top + footprint
                alpha = (bilinear(prefix, right, bottom) - bilinear(prefix, left, bottom)
                         - bilinear(prefix, right, top) + bilinear(prefix, left, top)) / footprint**2
                if float(alpha.min()) < -1e-8 or not np.isclose(alpha.sum(), expected, rtol=1e-10, atol=1e-8):
                    raise AssertionError("Filtered glyph ink changes with translation")


def generate() -> tuple[bytes, bytes]:
    font, image_bytes, metrics_bytes = source_description()
    source = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"), dtype=np.float64)
    if source.shape[:2] != (font["height"], font["width"]):
        raise ValueError("MSDF dimensions do not match source metrics")
    atlas = np.zeros((ROWS * CELL_SIZE, COLUMNS * CELL_SIZE, 3), dtype=np.uint8)
    maximum = 0
    for code in range(32, 128):
        glyph = font["glyphs"][code]
        prefix = np.zeros((CELL_SIZE, CELL_SIZE), dtype=np.uint32)
        if glyph and "planeBounds" in glyph:
            coverage = glyph_coverage(source, font, glyph)
            prefix[1:, 1:] = coverage.cumsum(axis=0, dtype=np.uint32).cumsum(axis=1, dtype=np.uint32)
        packed = pack(prefix)
        verify_integral(prefix, packed)
        tile = code - 32
        x, y = tile % COLUMNS * CELL_SIZE, tile // COLUMNS * CELL_SIZE
        atlas[y:y + CELL_SIZE, x:x + CELL_SIZE] = packed
        maximum = max(maximum, int(prefix[-1, -1]))
    output = io.BytesIO()
    Image.fromarray(atlas).save(output, format="PNG", compress_level=9)
    description = {
        "type": "summed-area", "atlasURL": "fonts/geist-ascii-integral.png",
        "width": COLUMNS * CELL_SIZE, "height": ROWS * CELL_SIZE,
        "emSize": EM_SIZE, "cellSize": CELL_SIZE, "columns": COLUMNS,
        "originX": ORIGIN_X, "originY": ORIGIN_Y, "coverageScale": COVERAGE_SCALE,
        "maxValue": maximum, "subsamples": SUBSAMPLES, "yOrigin": "top",
        "sourceAtlasSHA256": hashlib.sha256(image_bytes).hexdigest(),
        "sourceMetricsSHA256": hashlib.sha256(metrics_bytes).hexdigest(),
    }
    metadata = (
        "// Generated by scripts/generate-text-integral.py; do not edit.\n"
        "// Geist, SIL Open Font License 1.1; see geist-ascii-LICENSE.txt.\n"
        "// Top-origin 65 x 65 integral tiles for ASCII 32..127, RGB big-endian uint24.\n"
        "// Integral coordinates 0..64 sample texel centers .5..64.5 within each tile.\n"
        "globalThis.BoardfishAsciiIntegralFont = "
        + json.dumps(description, separators=(",", ":")) + ";\n"
    ).encode("utf-8")
    return output.getvalue(), metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify checked-in output without writing files")
    args = parser.parse_args()
    image, metadata = generate()
    for destination, data in ((OUTPUT_IMAGE, image), (OUTPUT_METRICS, metadata)):
        if args.check:
            if destination.read_bytes() != data:
                raise SystemExit(f"Generated output differs: {destination}")
        else:
            destination.write_bytes(data)
        print(f"{destination.name}: {len(data):,} bytes; SHA-256 {hashlib.sha256(data).hexdigest()}")
    print("Validated RGB24 filtering and translation-invariant ink for all 96 tiles at four device scales.")


if __name__ == "__main__":
    main()
