"""
Build the "memory of normal" (reference bank) for each equipment type.

    python -m scripts.build_bank                       # all three types
    python -m scripts.build_bank --type basketball

Input : dataset/<type>/reference/healthy/*.jpg   (healthy photos ONLY)
Output: banks/<type>/bank.npy          up to 30,000 healthy patch features (float16)
        banks/<type>/prototype.npy     average whole-image feature (wrong-type check)
        banks/<type>/bank_meta.json    what went in
        banks/<type>/calibration.json  first, automatic calibration (leave-one-item-out)

Steps
  1. Preprocess every reference photo (background replacement, 448x448).
  2. Add rotations/flips (config.AUGMENTATIONS) - more "normal" views for free.
  3. DINOv2 -> keep patch features that lie on the object.
  4. Greedy coreset -> at most 30,000 patches (fast search on a CPU).
  5. Automatic first calibration, "leave-one-item-out": for every physical item,
     score its photos against a bank built from all OTHER items. Those distances
     show how far a healthy-but-unseen item typically is from the bank, so
         tau        = 99th percentile of those distances
         d_severe   = tau + 0.20   (refined later by calibrate.py with damaged photos)
     This lets the service work right after this script; run calibrate.py next.

Typical time on a 4-core laptop CPU: ~3-6 minutes per type for 40 photos.
"""
from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone

import numpy as np
import torch

from app import config as C
from app.anomaly import ReferenceBank, greedy_coreset, nearest_distances, object_patch_features, smooth_map
from app.dataset import item_id, reference_images
from app.features import get_extractor
from app.health_score import Calibration
from app.preprocess import PhotoError, apply_augmentation, preprocess

MIN_REFERENCES = 10
LOO_MAX_PATCHES = 60000


def build(t: str) -> None:
    t0 = time.perf_counter()
    paths = reference_images(t)
    print(f"\n=== {C.EQUIPMENT_LABELS[t]}: {len(paths)} reference photos ===")
    if len(paths) < MIN_REFERENCES:
        raise SystemExit(f"Need at least {MIN_REFERENCES} healthy reference photos (40 recommended).")

    # 1. preprocess (photos that fail the gates are skipped and listed)
    pres, items, used = [], [], []
    for p in paths:
        try:
            pres.append(preprocess(p.read_bytes()))
            items.append(item_id(p))
            used.append(p.name)
        except PhotoError as e:
            print(f"  skip {p.name}: {e.code} {e.details}")
    print(f"  preprocessed {len(pres)} photos from {len(set(items))} items")

    ext = get_extractor()

    # 3a. un-augmented features: prototype, blur stats and leave-one-item-out
    base_feats, base_cls = ext.extract_batched([p.image for p in pres])

    # 2 + 3b. augmented features for the bank, kept per photo
    augs = C.AUGMENTATIONS[t]
    per_photo: list[np.ndarray] = []
    for pre, f in zip(pres, base_feats):
        chunks = [object_patch_features(f, pre)]                            # rot0
        extra = [apply_augmentation(pre, a) for a in augs if a != "rot0"]
        if extra:
            ef, _ = ext.extract_batched([e.image for e in extra])
            chunks += [object_patch_features(ff, e) for e, ff in zip(extra, ef)]
        per_photo.append(np.concatenate(chunks))
    all_feats = torch.from_numpy(np.concatenate(per_photo))
    print(f"  {all_feats.shape[0]} healthy object patches (with {len(augs)} views per photo)")

    # 4. coreset
    sel = greedy_coreset(all_feats, C.MAX_BANK_PATCHES)
    bank_feats = all_feats[sel].contiguous()
    print(f"  coreset -> {bank_feats.shape[0]} patches")

    # 5. leave-one-item-out distances (only one item? then leave-one-photo-out)
    groups = items if len(set(items)) > 1 else [str(i) for i in range(len(pres))]
    rng = np.random.default_rng(0)
    loo = []
    for g in sorted(set(groups)):
        others = np.concatenate([pf for pf, gg in zip(per_photo, groups) if gg != g])
        if others.shape[0] > LOO_MAX_PATCHES:
            others = others[rng.choice(others.shape[0], LOO_MAX_PATCHES, replace=False)]
        others_t = torch.from_numpy(others)
        for idx in [i for i, gg in enumerate(groups) if gg == g]:
            pre, f = pres[idx], base_feats[idx]
            keep = pre.patch_mask.reshape(-1) >= C.PATCH_OBJECT_MIN
            raw = np.zeros(C.GRID * C.GRID, np.float32)
            raw[keep] = nearest_distances(f[keep], others_t)
            sm = smooth_map(raw.reshape(C.GRID, C.GRID), pre.patch_mask)
            loo.append(sm[pre.patch_mask >= C.PATCH_OBJECT_MIN])
    loo_d = np.concatenate(loo)
    tau = float(np.percentile(loo_d, 99))

    proto = base_cls.mean(axis=0)
    proto /= np.linalg.norm(proto)
    own_sims = base_cls @ proto
    blur_scores = np.array([p.blur_score for p in pres])

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    bank = ReferenceBank(t, bank_feats, proto, {
        "equipment_type": t, "built_at": now, "model": C.DINO_MODEL_ID, "rembg": C.REMBG_MODEL,
        "image_size": C.IMAGE_SIZE, "n_photos": len(pres), "n_items": len(set(items)),
        "augmentations": augs, "patches_before_coreset": int(all_feats.shape[0]),
        "patches_in_bank": int(bank_feats.shape[0]), "photos": used,
    })
    out = C.BANKS_DIR / t
    bank.save(out)

    cal = Calibration(
        equipment_type=t, tau=round(tau, 4), d_severe=round(tau + C.DEFAULT_SEVERE_MARGIN, 4),
        blur_threshold=round(float(np.clip(0.25 * np.percentile(blur_scores, 5), 8.0, 60.0)), 2),
        type_min_similarity=round(float(own_sims.min()) - 0.10, 4),
        source="build_bank-leave-one-item-out", created_at=now,
        stats={"loo_patch_distance_p50": round(float(np.percentile(loo_d, 50)), 4),
               "loo_patch_distance_p99": round(tau, 4),
               "blur_score_p5": round(float(np.percentile(blur_scores, 5)), 2),
               "prototype_similarity_min": round(float(own_sims.min()), 4)},
    )
    cal.save(out / "calibration.json")
    print(f"  tau={cal.tau}  d_severe={cal.d_severe}  blur_threshold={cal.blur_threshold}  "
          f"type_min_similarity={cal.type_min_similarity}")
    print(f"  saved to {out}  ({time.perf_counter() - t0:.0f}s).  Next: python -m scripts.calibrate --type {t}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=C.EQUIPMENT_TYPES)
    args = ap.parse_args()
    for t in ([args.type] if args.type else C.EQUIPMENT_TYPES):
        if not reference_images(t):
            print(f"\n=== {C.EQUIPMENT_LABELS[t]}: no photos in dataset/{t}/reference/healthy - skipped ===")
            continue
        build(t)


if __name__ == "__main__":
    main()
