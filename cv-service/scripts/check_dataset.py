"""
Check the dataset folder BEFORE building banks: counts, item overlap, photo quality.

    python -m scripts.check_dataset                 # all three types
    python -m scripts.check_dataset --type football
    python -m scripts.check_dataset --create        # just create the empty folder tree

It prints, per type, how many photos you have vs. how many the guide asks for,
whether any physical item appears in BOTH reference/ and test/ (not allowed),
and which photos fail the quality gates (no object / too dark / blurry).
"""
from __future__ import annotations

import argparse
from collections import Counter

from app import config as C
from app.dataset import item_id, reference_images, test_images
from app.preprocess import PhotoError, preprocess

# Targets from the guide (section 2). "min" = the absolute minimum that works.
TARGETS = {
    "reference/healthy": (40, 24),
    "test/healthy": (16, 8),
    "test/damaged/fair": (10, 6),
    "test/damaged/poor": (10, 6),
    "test/damaged/replace": (10, 6),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=C.EQUIPMENT_TYPES)
    ap.add_argument("--skip-quality", action="store_true", help="only count files (fast)")
    ap.add_argument("--create", action="store_true", help="create the empty dataset folders and exit")
    args = ap.parse_args()

    if args.create:
        for t in C.EQUIPMENT_TYPES:
            for sub in TARGETS:
                (C.DATASET_DIR / t / sub).mkdir(parents=True, exist_ok=True)
        print(f"Created the folder tree under {C.DATASET_DIR}")
        return

    ok_all = True
    for t in ([args.type] if args.type else C.EQUIPMENT_TYPES):
        refs = reference_images(t)
        tests = test_images(t)
        groups = Counter()
        groups["reference/healthy"] = len(refs)
        for p, g in tests:
            groups["test/healthy" if g == 3 else f"test/damaged/{p.parent.name}"] += 1

        print(f"\n=== {C.EQUIPMENT_LABELS[t]} ===")
        for k, (target, minimum) in TARGETS.items():
            n = groups.get(k, 0)
            flag = "OK " if n >= target else ("min" if n >= minimum else "LOW")
            ok_all &= n >= minimum
            print(f"  [{flag}] {k:24s} {n:3d}  (target {target}, minimum {minimum})")

        ref_items = {item_id(p) for p in refs}
        test_items = {item_id(p) for p, _ in tests}
        overlap = sorted(ref_items & test_items)
        print(f"  distinct healthy reference items: {len(ref_items)} (target 10, minimum 6)")
        if overlap:
            ok_all = False
            print(f"  [ERR] items in BOTH reference and test (move them!): {', '.join(overlap)}")

        if args.skip_quality:
            continue
        bad = 0
        for p in refs + [p for p, _ in tests]:
            try:
                preprocess(p.read_bytes())
            except PhotoError as e:
                bad += 1
                print(f"  [BAD] {p.relative_to(C.DATASET_DIR)}: {e.code} {e.details}")
        print(f"  quality: {bad} photo(s) failed the gates" if bad else "  quality: all photos pass")
        ok_all &= bad == 0

    print("\nRESULT:", "dataset looks ready" if ok_all else "fix the items marked LOW / ERR / BAD above")


if __name__ == "__main__":
    main()
