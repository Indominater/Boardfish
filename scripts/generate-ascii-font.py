#!/usr/bin/env python3
"""Regenerate the checked-in Geist ASCII MSDF assets; see generate-ascii-font.md."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent.parent
FONT_SHA256 = "5eb88b972cad22bd9937079e8e8c7fd9fae22dd8e621ea23c2e733bb3e8c2ee5"
ATLAS_COMMIT = "2ede254314a2512252a225fa6c975948d6af559a"
MSDFGEN_COMMIT = "1874bcf7d9624ccc85b4bc9a85d78116f690f35b"
NAME = "geist-ascii-msdf"
OPTIONS = [
    "-fontname", "Geist Sans 400", "-chars", "[32,126]",
    "-type", "msdf", "-format", "png", "-size", "64", "-pxrange", "8",
    "-pots", "-yorigin", "bottom", "-pxalign", "off", "-nokerning",
    "-coloringstrategy", "inktrap", "-angle", "3", "-miterlimit", "1",
    "-nopreprocess", "-overlap", "-scanline", "-seed", "0", "-threads", "1",
]


def validate(metadata, png):
    atlas = metadata["atlas"]
    assert atlas["type"] == "msdf" and atlas["yOrigin"] == "bottom"
    assert atlas["size"] == 64 and atlas["distanceRange"] == 8
    assert atlas["width"] == atlas["height"] == 512
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", png[16:24]) == (atlas["width"], atlas["height"])
    assert png[24:26] == bytes([8, 2]), "Expected 8-bit RGB PNG"
    assert [glyph["unicode"] for glyph in metadata["glyphs"]] == list(range(32, 127))
    for glyph in metadata["glyphs"]:
        assert math.isfinite(glyph["advance"]) and glyph["advance"] > 0
        if glyph["unicode"] == 32:
            assert "planeBounds" not in glyph and "atlasBounds" not in glyph
            continue
        plane, texture = glyph["planeBounds"], glyph["atlasBounds"]
        assert all(math.isfinite(value) for box in (plane, texture) for value in box.values())
        assert plane["left"] < plane["right"] and plane["bottom"] < plane["top"]
        assert 0 <= texture["left"] < texture["right"] <= atlas["width"]
        assert 0 <= texture["bottom"] < texture["top"] <= atlas["height"]
        for lower, upper in [("left", "right"), ("bottom", "top")]:
            assert abs((plane[upper] - plane[lower]) * 64 - (texture[upper] - texture[lower])) < 1e-8


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generator", default=os.environ.get("MSDF_ATLAS_GEN", "msdf-atlas-gen"))
    parser.add_argument("--output-dir", type=Path, default=ROOT / "src/fonts")
    parser.add_argument("--check", action="store_true", help="Regenerate in a temporary directory and compare without writing")
    args = parser.parse_args()
    generator = shutil.which(args.generator)
    if not generator:
        parser.error("msdf-atlas-gen is missing; pass --generator and follow generate-ascii-font.md")
    try:
        import fontTools
        from fontTools.ttLib import TTFont
    except ImportError:
        parser.error("Install the generation-only FontTools/Brotli dependencies in generate-ascii-font.md")
    if fontTools.__version__ != "4.59.1":
        parser.error("Use fonttools==4.59.1 for reproducible conversion")
    version = subprocess.check_output([generator, "-version"], text=True)
    if "MSDF-Atlas-Gen v1.4.0\n" not in version or "with MSDFgen v1.13.0" not in version:
        parser.error("Use msdf-atlas-gen v1.4 with its pinned msdfgen submodule")
    source = ROOT / "src/fonts/Geist.woff2"
    if hashlib.sha256(source.read_bytes()).hexdigest() != FONT_SHA256:
        parser.error("Geist.woff2 changed; review the font and update the source checksum before regenerating")
    with tempfile.TemporaryDirectory(prefix="boardfish-ascii-font-") as directory:
        temporary = Path(directory)
        with TTFont(source, recalcTimestamp=False) as font:
            assert font["head"].unitsPerEm == 1000
            assert [(axis.axisTag, axis.defaultValue) for axis in font["fvar"].axes] == [("wght", 400)]
            font_version = font["name"].getDebugName(5)
            copyright_notice = font["name"].getDebugName(0)
            font.flavor = None
            font.save(temporary / "Geist.ttf")
        png_path, json_path = temporary / f"{NAME}.png", temporary / f"{NAME}.json"
        subprocess.run([
            generator, "-varfont", f"{temporary / 'Geist.ttf'}?wght=400", *OPTIONS,
            "-imageout", str(png_path), "-json", str(json_path),
        ], check=True)
        metadata, png = json.loads(json_path.read_text()), png_path.read_bytes()
        validate(metadata, png)
        metadata["source"] = {
            "font": "Geist.woff2", "sha256": FONT_SHA256, "version": font_version,
            "weight": 400, "copyright": copyright_notice, "license": "SIL Open Font License 1.1",
            "licenseFile": "geist-ascii-OFL.txt",
        }
        metadata["generator"] = {
            "name": "msdf-atlas-gen", "version": "1.4.0", "commit": ATLAS_COMMIT,
            "msdfgenVersion": "1.13.0", "msdfgenCommit": MSDFGEN_COMMIT,
            "fontToolsVersion": fontTools.__version__, "options": OPTIONS,
        }
        outputs = {f"{NAME}.png": png, f"{NAME}.json": (json.dumps(metadata, indent=2) + "\n").encode()}
        if args.check:
            for filename, content in outputs.items():
                assert (args.output_dir / filename).read_bytes() == content, f"Regeneration differs: {filename}"
            print("Atlas and metadata reproduce exactly; 95 ASCII metrics / 94 drawable glyphs validated.")
        else:
            args.output_dir.mkdir(parents=True, exist_ok=True)
            for filename, content in outputs.items():
                (args.output_dir / filename).write_bytes(content)
            print(f"Wrote 512 x 512 atlas and metadata to {args.output_dir}")


if __name__ == "__main__":
    main()
