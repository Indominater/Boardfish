#!/usr/bin/env python3
"""Build immutable, continuously filtered ASCII glyph scale-space.

The source is the same coverage reconstructed from the checked-in MSDF as the
summed-area atlas. Each layer convolves that coverage with a physical-pixel box
and a Gaussian before sampling. The PNG transports IEEE binary16 coverage in
its red and green bytes; upload those bits to one linearly filtered R16F texture.

Dependencies: NumPy and Pillow. --check verifies byte-for-byte reproducibility.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("text_integral", Path(__file__).with_name("generate-text-integral.py"))
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)

CELL_SIZE = 64
ORIGIN_X = -0.5
ORIGIN_Y = -1.25
EM_EXTENT = 2.0
COLUMNS = 8
GLYPH_ROWS = 12
LAYERS = 16
LAYER_COLUMNS = 4
LAYER_WIDTH = COLUMNS * CELL_SIZE
LAYER_HEIGHT = GLYPH_ROWS * CELL_SIZE
WIDTH = LAYER_WIDTH * LAYER_COLUMNS
HEIGHT = LAYER_HEIGHT * math.ceil(LAYERS / LAYER_COLUMNS)
MIN_DEVICE_EM = 1.6
MAX_DEVICE_EM = 12.0
SIGMA = 0.65
PIXEL_PADDING = 2.5
OUTPUT_IMAGE = ROOT / "src/fonts/geist-ascii-coverage.png"
OUTPUT_METRICS = ROOT / "src/fonts/geist-ascii-coverage.js"


def normal_cdf(values: np.ndarray) -> np.ndarray:
    return 0.5 + 0.5 * np.fromiter((math.erf(float(v) / math.sqrt(2)) for v in values.flat), dtype=np.float64).reshape(values.shape)


def kernel_integral(values: np.ndarray, sigma: float) -> np.ndarray:
    """An antiderivative of the Gaussian CDF, stable for this bounded domain."""
    normalized = values / sigma
    return values * normal_cdf(normalized) + sigma / math.sqrt(2 * math.pi) * np.exp(-0.5 * normalized**2)


def layer_grid(device_em: float) -> tuple[float, float, float]:
    padding = PIXEL_PADDING / device_em
    return ORIGIN_X - padding, ORIGIN_Y - padding, CELL_SIZE / (EM_EXTENT + 2 * padding)


def convolution_weights(output_origin: float, input_origin: float, device_em: float, density: float) -> np.ndarray:
    """Exactly integrate Gaussian * pixel-box over each constant source cell."""
    output = output_origin + (np.arange(CELL_SIZE) + 0.5) / density
    source = input_origin + (np.arange(SOURCE.CELLS) + 0.5) / SOURCE.EM_SIZE
    delta = output[:, None] - source[None, :]
    half_cell = 0.5 / SOURCE.EM_SIZE
    half_box = 0.5 / device_em
    sigma = SIGMA / device_em
    h = lambda values: kernel_integral(values, sigma)
    weights = (h(delta + half_cell + half_box) - h(delta - half_cell + half_box)
               - h(delta + half_cell - half_box) + h(delta - half_cell - half_box)) / (2 * half_box)
    return np.maximum(weights, 0)


def sample_tile(tile: np.ndarray, x: np.ndarray, y: np.ndarray, layer: int) -> np.ndarray:
    """Match bilinear R16F sampling, including the adaptive layer's coordinates."""
    device_em = MIN_DEVICE_EM * (MAX_DEVICE_EM / MIN_DEVICE_EM)**(layer / (LAYERS - 1))
    origin_x, origin_y, density = layer_grid(device_em)
    qx = (x - origin_x) * density - 0.5
    qy = (y - origin_y) * density - 0.5
    inside = (qx >= -0.5) & (qy >= -0.5) & (qx <= CELL_SIZE - 0.5) & (qy <= CELL_SIZE - 0.5)
    return SOURCE.bilinear(tile.astype(np.float64), qx, qy) * inside


def sample_layers(tiles: np.ndarray, device_em: float, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    level = np.clip(math.log(device_em / MIN_DEVICE_EM) / math.log(MAX_DEVICE_EM / MIN_DEVICE_EM) * (LAYERS - 1), 0, LAYERS - 1)
    first = int(level)
    fraction = level - first
    return ((1 - fraction) * sample_tile(tiles[first], x, y, first)
            + fraction * sample_tile(tiles[min(first + 1, LAYERS - 1)], x, y, min(first + 1, LAYERS - 1)))


def verify_tiles(all_tiles: np.ndarray, coverages: list[np.ndarray]) -> dict:
    """Check decoded fields and physical-pixel translation, including log blends."""
    maximum_bias = 0.0
    maximum_phase = 0.0
    per_scale = []
    for device_em in (1.6, 1.8, 2.0, 2.4, 3.2, 4.8, 6.4, 8.0, 10.0, 12.0):
        worst_phase = 0.0
        worst_bias = 0.0
        for code in (46, 45, 95, 105, 124, 72, 101, 65):
            source_ink = coverages[code - 32].sum() / 255 / SOURCE.EM_SIZE**2
            expected = source_ink * device_em**2
            pixels = np.arange(-math.ceil(3 * device_em) - 3, math.ceil(3 * device_em) + 3)
            xx, yy = np.meshgrid(pixels, pixels)
            masses = []
            for axis in (0, 1):
                for phase in np.arange(64) / 64:
                    x = (xx + (phase if axis == 0 else 0.375)) / device_em
                    y = (yy + (phase if axis == 1 else 0.375)) / device_em
                    masses.append(float(sample_layers(all_tiles[:, code - 32], device_em, x, y).sum()))
            mean = float(np.mean(masses))
            phase_range = (max(masses) - min(masses)) / mean
            bias = abs(mean / expected - 1)
            worst_phase = max(worst_phase, phase_range)
            worst_bias = max(worst_bias, bias)
        maximum_bias = max(maximum_bias, worst_bias)
        maximum_phase = max(maximum_phase, worst_phase)
        per_scale.append({"deviceEm": device_em, "worstInkBiasPercent": round(worst_bias * 100, 5),
                          "worstPhaseRangePercent": round(worst_phase * 100, 5)})
    if maximum_phase > 0.035 or maximum_bias > 0.01:
        raise AssertionError(f"Unexpected coverage reconstruction error: bias={maximum_bias}, phase={maximum_phase}")
    return {"phaseSteps": 64, "glyphs": ".-_i|HeA", "scales": per_scale}


def generate() -> tuple[bytes, bytes, dict]:
    font, image_bytes, metrics_bytes = SOURCE.source_description()
    image = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("RGB"), dtype=np.float64)
    coverages = [SOURCE.glyph_coverage(image, font, glyph) if glyph and "planeBounds" in glyph
                 else np.zeros((SOURCE.CELLS, SOURCE.CELLS), dtype=np.uint32)
                 for glyph in font["glyphs"][32:128]]
    tiles = np.zeros((LAYERS, 96, CELL_SIZE, CELL_SIZE), dtype=np.float16)
    atlas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    scales = np.geomspace(MIN_DEVICE_EM, MAX_DEVICE_EM, LAYERS)
    maximum_edge = 0.0
    for layer, device_em in enumerate(scales):
        origin_x, origin_y, density = layer_grid(device_em)
        wx = convolution_weights(origin_x, SOURCE.ORIGIN_X, device_em, density)
        wy = convolution_weights(origin_y, SOURCE.ORIGIN_Y, device_em, density)
        for index, coverage in enumerate(coverages):
            filtered = np.clip(wy @ (coverage.astype(np.float64) / 255) @ wx.T, 0, 1)
            tile = filtered.astype(np.float16)
            # The geometric draw uses a finite 2.5-pixel guard around actual
            # glyph ink. Samples outside that guard would not be drawn. Bake
            # the same guard here so tests cover the exact bounded field.
            occupied = np.argwhere(coverage > 0)
            if occupied.size:
                y0, x0 = occupied.min(axis=0)
                y1, x1 = occupied.max(axis=0) + 1
                x = origin_x + (np.arange(CELL_SIZE) + 0.5) / density
                y = origin_y + (np.arange(CELL_SIZE) + 0.5) / density
                guard = PIXEL_PADDING / device_em
                inside_x = ((x >= SOURCE.ORIGIN_X + x0 / SOURCE.EM_SIZE - guard)
                            & (x <= SOURCE.ORIGIN_X + x1 / SOURCE.EM_SIZE + guard))
                inside_y = ((y >= SOURCE.ORIGIN_Y + y0 / SOURCE.EM_SIZE - guard)
                            & (y <= SOURCE.ORIGIN_Y + y1 / SOURCE.EM_SIZE + guard))
                tile *= inside_y[:, None] & inside_x[None, :]
            maximum_edge = max(maximum_edge, float(tile[0].max()), float(tile[-1].max()),
                               float(tile[:, 0].max()), float(tile[:, -1].max()))
            tiles[layer, index] = tile
            x = layer % LAYER_COLUMNS * LAYER_WIDTH + index % COLUMNS * CELL_SIZE
            y = layer // LAYER_COLUMNS * LAYER_HEIGHT + index // COLUMNS * CELL_SIZE
            bits = tile.view(np.uint16)
            atlas[y:y + CELL_SIZE, x:x + CELL_SIZE, 0] = bits >> 8
            atlas[y:y + CELL_SIZE, x:x + CELL_SIZE, 1] = bits & 255
    if maximum_edge:
        raise AssertionError(f"Glyph padding reaches a tile edge: {maximum_edge}")
    # PNG is a transport for half-float bits, not a displayable color image.
    # Verify the same byte assembly used by the browser's one-time upload.
    decoded = ((atlas[:, :, 0].astype(np.uint16) << 8)
               | atlas[:, :, 1].astype(np.uint16)).view(np.float16)
    if not np.isfinite(decoded).all() or np.any(decoded < 0) or np.any(decoded > 1):
        raise AssertionError("Invalid transported half-float coverage")
    for layer in range(LAYERS):
        for index in range(96):
            x = layer % LAYER_COLUMNS * LAYER_WIDTH + index % COLUMNS * CELL_SIZE
            y = layer // LAYER_COLUMNS * LAYER_HEIGHT + index // COLUMNS * CELL_SIZE
            if not np.array_equal(decoded[y:y + CELL_SIZE, x:x + CELL_SIZE], tiles[layer, index]):
                raise AssertionError("Half-float PNG transport changed coverage")
    verification = verify_tiles(tiles, coverages)
    encoded = io.BytesIO()
    Image.fromarray(atlas).save(encoded, format="PNG", compress_level=9)
    description = {
        "type": "gaussian-coverage", "atlasURL": "fonts/geist-ascii-coverage.png",
        "width": WIDTH, "height": HEIGHT, "emExtent": EM_EXTENT, "cellSize": CELL_SIZE,
        "columns": COLUMNS, "originX": ORIGIN_X, "originY": ORIGIN_Y,
        "adaptiveGrid": True,
        "layers": LAYERS, "layerColumns": LAYER_COLUMNS, "layerWidth": LAYER_WIDTH,
        "layerHeight": LAYER_HEIGHT, "minDeviceEm": MIN_DEVICE_EM, "maxDeviceEm": MAX_DEVICE_EM,
        "sigma": SIGMA, "pixelPadding": PIXEL_PADDING, "encoding": "float16-rg", "yOrigin": "top",
        "sourceAtlasSHA256": hashlib.sha256(image_bytes).hexdigest(),
        "sourceMetricsSHA256": hashlib.sha256(metrics_bytes).hexdigest(),
    }
    metadata = ("// Generated by scripts/generate-text-coverage.py; do not edit.\n"
                "// Geist, SIL Open Font License 1.1; see geist-ascii-LICENSE.txt.\n"
                "// Red/green transport high/low IEEE binary16 bytes; upload to R16F with HALF_FLOAT.\n"
                "globalThis.BoardfishAsciiCoverageFont = "
                + json.dumps(description, separators=(",", ":")) + ";\n").encode("utf-8")
    return encoded.getvalue(), metadata, verification


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify checked-in output without writing")
    args = parser.parse_args()
    image, metadata, verification = generate()
    for path, data in ((OUTPUT_IMAGE, image), (OUTPUT_METRICS, metadata)):
        if args.check:
            if path.read_bytes() != data:
                raise SystemExit(f"Generated output differs: {path}")
        else:
            path.write_bytes(data)
        print(f"{path.name}: {len(data):,} bytes; SHA-256 {hashlib.sha256(data).hexdigest()}")
    print(json.dumps(verification, indent=2))


if __name__ == "__main__":
    main()
