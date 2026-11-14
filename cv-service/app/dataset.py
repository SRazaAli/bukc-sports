"""
Helpers for the photo dataset folder (see the guide, section 2).

dataset/
  basketball/
    reference/healthy/          BB-H01_a1.jpg ...  -> builds the memory of normal
    test/healthy/               BB-H11_a1.jpg ...  -> calibration (never in the bank)
    test/damaged/fair/          BB-D01_a1.jpg ...
    test/damaged/poor/
    test/damaged/replace/
  football/          (same layout, prefix FB-)
  volleyball/        (same layout, prefix VB-)

File name = <ITEM-ID>_a<angle>.jpg  ->  the part before "_a" identifies the
physical item, so all angles of one item stay together (no item may appear in
both reference/ and test/).
"""
from __future__ import annotations

import re
from pathlib import Path

from . import config as C

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
GRADES = {"healthy": 3, "fair": 2, "poor": 1, "replace": 0}       # ordinal ground truth
GRADE_TO_LABEL = {3: "GOOD", 2: "FAIR", 1: "POOR", 0: "REPLACE"}
_ITEM_RE = re.compile(r"^(?P<item>.+?)_a\d+$", re.IGNORECASE)


def item_id(path: Path) -> str:
    m = _ITEM_RE.match(path.stem)
    return m.group("item").upper() if m else path.stem.upper()


def list_images(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXT and not p.name.startswith("."))


def reference_images(t: str, root: Path = C.DATASET_DIR) -> list[Path]:
    return list_images(root / t / "reference" / "healthy")


def test_images(t: str, root: Path = C.DATASET_DIR) -> list[tuple[Path, int]]:
    """[(path, grade)] for test/healthy and test/damaged/{fair,poor,replace}."""
    out = [(p, GRADES["healthy"]) for p in list_images(root / t / "test" / "healthy")]
    for g in ("fair", "poor", "replace"):
        out += [(p, GRADES[g]) for p in list_images(root / t / "test" / "damaged" / g)]
    return out
