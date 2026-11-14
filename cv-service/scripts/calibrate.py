"""
Calibrate the health score for one equipment type using HELD-OUT test photos.

    python -m scripts.calibrate --type basketball
    python -m scripts.calibrate                      # all types that have a bank

Needs: banks/<type>/ (from build_bank.py) and
       dataset/<type>/test/healthy/*              (graded "Good")
       dataset/<type>/test/damaged/fair|poor|replace/*   (graded by the coordinator)

What it fits, in plain words
  tau         99th percentile of patch distances on the HEALTHY test photos
              -> only ~1% of a healthy item's surface may look "unusual".
  d_severe    median "worst-spot distance" of the REPLACE photos
              -> a typical replace-level defect counts as 100% severe.
  w_S, C_full small grid search: the combination whose scores best follow the
              coordinator's grades (Spearman rank correlation).
  thresholds  Good/Fair/Poor/Replace cut-offs that best separate the graded
              groups (balanced accuracy), kept in order with >= 5 points gap.
  type check  lowest similarity of a genuine photo to its type prototype, minus 0.05.

Writes banks/<type>/calibration.json and banks/<type>/calibration_report.md
(+ scores.csv with the score of every test photo).
NOTE: the report is measured on the same photos used to fit, so it is a little
optimistic. Re-shoot a few fresh items later to confirm (see the guide, 5.4).
"""
from __future__ import annotations

import argparse
import csv
import itertools
from datetime import datetime, timezone

import numpy as np
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

from app import config as C
from app.dataset import GRADE_TO_LABEL, test_images
from app.health_score import Calibration, label_for, score_from_distances
from app.pipeline import Engine
from app.preprocess import PhotoError, preprocess
from app.anomaly import distance_map

W_GRID = [0.5, 0.6, 0.7]
CFULL_GRID = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40]
MIN_GAP = 5
# Thresholds may only move inside these bands, so a small test set cannot push
# them to silly values (e.g. "Poor starts at 14").
BANDS = {"good": (70, 90), "fair": (50, 75), "poor": (25, 55)}


def best_threshold(scores: np.ndarray, positive: np.ndarray, default: int) -> int:
    """Cut-off t so that (score >= t) best matches `positive` (balanced accuracy)."""
    if positive.sum() < 2 or (~positive).sum() < 2:
        return default
    best_t, best_ba = default, -1.0
    for t in range(1, 100):
        pred = scores >= t
        ba = 0.5 * (pred[positive].mean() + (~pred[~positive]).mean())
        if ba > best_ba + 1e-9 or (abs(ba - best_ba) < 1e-9 and abs(t - default) < abs(best_t - default)):
            best_t, best_ba = t, ba
    return best_t


def calibrate(engine: Engine, t: str) -> None:
    samples = test_images(t)
    print(f"\n=== {C.EQUIPMENT_LABELS[t]}: {len(samples)} test photos ===")
    if not samples:
        print("  no test photos - skipped")
        return
    bank, old = engine.banks[t], engine.calibrations[t]

    rows = []   # (path, grade, object_distances, cls)
    for p, g in samples:
        try:
            pre = preprocess(p.read_bytes(), check_quality=False)
        except PhotoError as e:
            print(f"  skip {p.name}: {e.code}")
            continue
        feats, cls = engine.extractor.extract([pre.image])
        dmap = distance_map(feats[0], pre, bank)
        rows.append((p, g, dmap[pre.patch_mask >= C.PATCH_OBJECT_MIN], cls[0]))
    grades = np.array([r[1] for r in rows])
    healthy = grades == 3
    print(f"  usable: {healthy.sum()} healthy, {(grades < 3).sum()} damaged "
          f"(fair {(grades == 2).sum()}, poor {(grades == 1).sum()}, replace {(grades == 0).sum()})")

    # ── tau ──
    tau = old.tau
    if healthy.sum() >= 5:
        tau = float(np.percentile(np.concatenate([r[2] for r, h in zip(rows, healthy) if h]), 99))

    # ── d_severe ──
    def worst_spot(d):
        k = max(C.TOPK_MIN, int(np.ceil(C.TOPK_FRACTION * d.size)))
        return float(np.sort(d)[-k:].mean())
    worst = np.array([worst_spot(r[2]) for r in rows])
    if (grades == 0).sum() >= 2:
        d_sev = float(np.median(worst[grades == 0]))
    elif (grades == 1).sum() >= 2:
        d_sev = float(np.percentile(worst[grades == 1], 75))
    else:
        d_sev = tau + C.DEFAULT_SEVERE_MARGIN
    d_sev = max(d_sev, tau + 0.05)

    # ── weights (grid search on rank agreement with the coordinator's grades) ──
    def scores_for(cal):
        return np.array([score_from_distances(r[2], cal).health for r in rows])
    cal = Calibration(equipment_type=t, tau=round(tau, 4), d_severe=round(d_sev, 4),
                      blur_threshold=old.blur_threshold, type_min_similarity=old.type_min_similarity)
    best = (C.DEFAULT_WEIGHT_SEVERITY, C.DEFAULT_COVERAGE_FULL, -2.0)
    if len(set(grades)) > 1:
        for w, cf in itertools.product(W_GRID, CFULL_GRID):
            cal.w_severity, cal.w_coverage, cal.coverage_full = w, round(1 - w, 2), cf
            rho = spearmanr(scores_for(cal), grades).statistic
            rho = -2.0 if np.isnan(rho) else rho
            closer = abs(w - C.DEFAULT_WEIGHT_SEVERITY) + abs(cf - C.DEFAULT_COVERAGE_FULL) < \
                abs(best[0] - C.DEFAULT_WEIGHT_SEVERITY) + abs(best[1] - C.DEFAULT_COVERAGE_FULL)
            if rho > best[2] + 1e-6 or (abs(rho - best[2]) <= 1e-6 and closer):
                best = (w, cf, rho)
    cal.w_severity, cal.w_coverage, cal.coverage_full = best[0], round(1 - best[0], 2), best[1]
    scores = scores_for(cal)

    # ── label thresholds ──
    d = C.DEFAULT_THRESHOLDS
    clamp = lambda v, k: int(min(max(v, BANDS[k][0]), BANDS[k][1]))  # noqa: E731
    good = clamp(best_threshold(scores, grades >= 3, d["good"]), "good")
    fair = clamp(min(best_threshold(scores, grades >= 2, d["fair"]), good - MIN_GAP), "fair")
    poor = clamp(min(best_threshold(scores, grades >= 1, d["poor"]), fair - MIN_GAP), "poor")
    cal.thresholds = {"good": good, "fair": fair, "poor": poor}

    # ── wrong-type floor ──
    own = np.array([float(np.dot(r[3], bank.prototype)) for r in rows])
    cal.type_min_similarity = round(min(old.type_min_similarity + 0.10, float(own.min())) - 0.05, 4)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cal.source, cal.created_at = "calibrate", now
    labels = [label_for(s, cal.thresholds) for s in scores]
    truth = [GRADE_TO_LABEL[g] for g in grades]
    auroc = float(roc_auc_score(grades < 3, -scores)) if 0 < (grades < 3).sum() < len(grades) else None
    rho = spearmanr(scores, grades).statistic if len(set(grades)) > 1 else None
    exact = float(np.mean([a == b for a, b in zip(labels, truth)]))
    cal.stats = {"n_healthy": int(healthy.sum()), "n_damaged": int((grades < 3).sum()),
                 "auroc_healthy_vs_damaged": None if auroc is None else round(auroc, 3),
                 "spearman_score_vs_grade": None if rho is None else round(float(rho), 3),
                 "label_accuracy": round(exact, 3),
                 "mean_score_by_grade": {GRADE_TO_LABEL[g]: round(float(scores[grades == g].mean()), 1)
                                         for g in sorted(set(grades), reverse=True)}}
    out = C.BANKS_DIR / t
    cal.save(out / "calibration.json")

    with open(out / "scores.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["file", "true_grade", "health_score", "predicted_label"])
        for r, s, lab, tr in zip(rows, scores, labels, truth):
            w.writerow([r[0].relative_to(C.DATASET_DIR), tr, int(s), lab])

    order = ["GOOD", "FAIR", "POOR", "REPLACE"]
    cm = "| true \\ predicted | " + " | ".join(order) + " |\n|---|" + "---|" * 4 + "\n"
    for tr in order:
        cm += f"| {tr} | " + " | ".join(str(sum(1 for a, b in zip(truth, labels) if a == tr and b == pr))
                                         for pr in order) + " |\n"
    (out / "calibration_report.md").write_text(
        f"# Calibration report - {C.EQUIPMENT_LABELS[t]}\n\nCreated {now}\n\n"
        f"* tau = {cal.tau}, d_severe = {cal.d_severe}\n"
        f"* w_S = {cal.w_severity}, w_C = {cal.w_coverage}, C_full = {cal.coverage_full}\n"
        f"* thresholds: Good >= {cal.thresholds['good']}, Fair >= {cal.thresholds['fair']}, "
        f"Poor >= {cal.thresholds['poor']}, else Replace\n"
        f"* AUROC healthy vs damaged: {cal.stats['auroc_healthy_vs_damaged']}\n"
        f"* Spearman (score vs grade): {cal.stats['spearman_score_vs_grade']}\n"
        f"* exact label accuracy: {cal.stats['label_accuracy']}\n"
        f"* mean score by true grade: {cal.stats['mean_score_by_grade']}\n\n## Confusion matrix\n\n{cm}\n"
        "Measured on the same photos used for fitting - expect slightly lower numbers on new photos.\n")
    print(f"  tau={cal.tau} d_severe={cal.d_severe} w_S={cal.w_severity} C_full={cal.coverage_full}")
    print(f"  thresholds={cal.thresholds}  AUROC={cal.stats['auroc_healthy_vs_damaged']}  "
          f"spearman={cal.stats['spearman_score_vs_grade']}  label accuracy={exact:.2f}")
    print(f"  mean score by grade: {cal.stats['mean_score_by_grade']}")
    print(f"  wrote {out / 'calibration.json'} and calibration_report.md")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=C.EQUIPMENT_TYPES)
    args = ap.parse_args()
    engine = Engine.load()
    types = [args.type] if args.type else list(engine.banks)
    for t in types:
        if t not in engine.banks:
            print(f"No bank for {t}. Run: python -m scripts.build_bank --type {t}")
            continue
        calibrate(engine, t)
    print("\nRestart the CV service so it loads the new calibration.")


if __name__ == "__main__":
    main()
