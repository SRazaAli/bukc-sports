"""
Score photos from the command line (no web server needed) - handy for testing.

    python -m scripts.score_image --type basketball path/to/photo1.jpg [photo2.jpg ...]

Prints the result and writes <photo>_heatmap.jpg next to each input photo.
"""
from __future__ import annotations

import argparse
import base64
from pathlib import Path

from app import config as C
from app.pipeline import Engine, ServiceError
from app.preprocess import PhotoError


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", required=True, choices=C.EQUIPMENT_TYPES)
    ap.add_argument("photos", nargs="+", type=Path)
    args = ap.parse_args()
    engine = Engine.load()
    try:
        r = engine.health_check([p.read_bytes() for p in args.photos], args.type)
    except (PhotoError, ServiceError) as e:
        raise SystemExit(f"ERROR {e.code}: {e.message} {e.details}")
    print(f"Health score : {r['health_score']}/100  ({r['label_text']})")
    print(f"Anomaly area : {r['anomaly_percent']}%   severity {r['severity']}   confidence {r['confidence']}")
    for v, p in zip(r["views"], args.photos):
        out = p.with_name(p.stem + "_heatmap.jpg")
        out.write_bytes(base64.b64decode(v["heatmap_image"].split(",", 1)[1]))
        print(f"  {p.name}: {v['health_score']}/100, anomaly {v['anomaly_percent']}% -> {out.name}")
    for w in r["warnings"]:
        print("  warning:", w)


if __name__ == "__main__":
    main()
