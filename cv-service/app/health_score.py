"""
Step 4 of the pipeline: turning detected anomalies into a 0-100 HEALTH SCORE.

Inputs per photo (all produced by anomaly.py):
  d_i   = for each object patch i, its distance to the nearest healthy patch
          (cosine distance, 0 = looks exactly like something healthy)

Per-equipment-type calibrated constants (calibration.json):
  tau        "normal ceiling"  - distances above this are anomalous
  d_severe   "clearly severe"  - distances at/above this count as 100% severe
  w_S, w_C   weights of severity and coverage (default 0.6 / 0.4)
  C_full     coverage at which the coverage penalty is maxed (default 25%)

Formula (all steps are simple and explainable):
  1. patch severity      s_i = clip((d_i - tau) / (d_severe - tau), 0, 1)
  2. anomaly coverage    C   = (# object patches with d_i > tau) / (# object patches)
  3. severity            S   = mean of the worst 1% of s_i (at least 3 patches)
  4. coverage penalty    Cn  = min(1, C / C_full)
  5. penalty             P   = w_S * S + w_C * Cn
  6. HEALTH SCORE        H   = round(100 * (1 - P))   (0..100)

Labels (defaults, tuned per type by calibrate.py):
  H >= 80 Good  |  60-79 Fair  |  40-59 Poor  |  < 40 Replace

Several photos (angles) of one item:
  H_item = round(0.7 * min(H_views) + 0.3 * mean(H_views))
  coverage_item = mean of the views' coverages; severity_item = max of the views'.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from . import config as C

LABELS = ("GOOD", "FAIR", "POOR", "REPLACE")
LABEL_TEXT = {"GOOD": "Good", "FAIR": "Fair", "POOR": "Poor", "REPLACE": "Replace"}
ADVICE = {
    "GOOD": "The equipment is in good condition and has plenty of usable life left.",
    "FAIR": "Visible wear was found. The item is usable — keep an eye on the highlighted areas.",
    "POOR": "Clear damage was found. Inspect the item by hand before lending it again.",
    "REPLACE": "Severe damage was found. Take the item out of use and plan a replacement.",
}


@dataclass
class Calibration:
    equipment_type: str
    tau: float
    d_severe: float
    w_severity: float = C.DEFAULT_WEIGHT_SEVERITY
    w_coverage: float = C.DEFAULT_WEIGHT_COVERAGE
    coverage_full: float = C.DEFAULT_COVERAGE_FULL
    thresholds: dict = field(default_factory=lambda: dict(C.DEFAULT_THRESHOLDS))
    blur_threshold: float = C.DEFAULT_BLUR_THRESHOLD
    type_min_similarity: float = 0.0
    source: str = "defaults"
    created_at: str = ""
    stats: dict = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "Calibration":
        data = json.loads(Path(path).read_text())
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self, path: Path) -> None:
        Path(path).write_text(json.dumps(asdict(self), indent=2))


@dataclass
class ViewScore:
    health: int
    coverage: float      # 0..1  share of the object area that is anomalous
    severity: float      # 0..1  how bad the worst spots are
    penalty: float
    n_object_patches: int
    n_anomalous_patches: int


def patch_severity(dist: np.ndarray, cal: Calibration) -> np.ndarray:
    """Step 1: per-patch severity in [0, 1]."""
    span = max(cal.d_severe - cal.tau, 1e-6)
    return np.clip((dist - cal.tau) / span, 0.0, 1.0)


def score_from_distances(object_dist: np.ndarray, cal: Calibration) -> ViewScore:
    """Steps 1-6 for ONE photo. `object_dist` = distances of the object patches only."""
    n = int(object_dist.size)
    if n == 0:
        raise ValueError("no object patches")
    sev = patch_severity(object_dist, cal)
    anomalous = object_dist > cal.tau
    coverage = float(anomalous.mean())                                     # step 2
    k = max(C.TOPK_MIN, int(np.ceil(C.TOPK_FRACTION * n)))
    k = min(k, n)
    severity = float(np.sort(sev)[-k:].mean())                             # step 3
    cov_norm = min(1.0, coverage / max(cal.coverage_full, 1e-6))           # step 4
    penalty = cal.w_severity * severity + cal.w_coverage * cov_norm        # step 5
    health = int(round(100.0 * (1.0 - min(max(penalty, 0.0), 1.0))))      # step 6
    return ViewScore(health=health, coverage=coverage, severity=severity, penalty=penalty,
                     n_object_patches=n, n_anomalous_patches=int(anomalous.sum()))


def label_for(score: float, thresholds: dict) -> str:
    if score >= thresholds["good"]:
        return "GOOD"
    if score >= thresholds["fair"]:
        return "FAIR"
    if score >= thresholds["poor"]:
        return "POOR"
    return "REPLACE"


def aggregate_views(views: list[ViewScore]) -> dict:
    """Combine several angles of the SAME item into one result."""
    scores = np.array([v.health for v in views], dtype=float)
    w = C.MULTI_VIEW_MIN_WEIGHT if len(views) > 1 else 1.0
    health = int(round(w * scores.min() + (1 - w) * scores.mean()))
    return {
        "health_score": health,
        "anomaly_percent": round(100.0 * float(np.mean([v.coverage for v in views])), 1),
        "severity": round(float(max(v.severity for v in views)), 3),
        "worst_view_index": int(scores.argmin()),
    }
