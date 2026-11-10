"""
Glue code: photo bytes in -> health result out.

    preprocess (background replacement + quality gates)
      -> DINOv2 patch features
      -> nearest-healthy-patch distances (memory of normal)
      -> health score + label + heatmap

Used by the FastAPI app (app/main.py) and by scripts/calibrate.py.
"""
from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass

from PIL import Image

from . import config as C
from .anomaly import ReferenceBank, ViewResult, score_view, type_check
from .features import DinoFeatureExtractor, get_extractor
from .health_score import ADVICE, LABEL_TEXT, Calibration, aggregate_views, label_for
from .preprocess import PhotoError, preprocess

log = logging.getLogger("cv.pipeline")


class ServiceError(Exception):
    """Not the photo's fault: e.g. no reference bank built yet for this type."""

    def __init__(self, code: str, message: str, status: int = 503, details: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details or {}


def to_jpeg_b64(img: Image.Image, quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


@dataclass
class Engine:
    extractor: DinoFeatureExtractor
    banks: dict[str, ReferenceBank]
    calibrations: dict[str, Calibration]

    @classmethod
    def load(cls) -> "Engine":
        banks, cals = {}, {}
        for t in C.EQUIPMENT_TYPES:
            folder = C.BANKS_DIR / t
            if (folder / "bank.npy").exists() and (folder / "calibration.json").exists():
                banks[t] = ReferenceBank.load(folder)
                cals[t] = Calibration.load(folder / "calibration.json")
                log.info("loaded bank %s: %d patches, calibration=%s", t, banks[t].size, cals[t].source)
            else:
                log.warning("no reference bank for %s (run scripts/build_bank.py)", t)
        return cls(extractor=get_extractor(), banks=banks, calibrations=cals)

    @property
    def model_version(self) -> str:
        return f"dinov2-small+{C.REMBG_MODEL}"

    def version_for(self, t: str) -> str:
        b, c = self.banks[t], self.calibrations[t]
        return f"{self.model_version}|bank:{b.meta.get('built_at', '?')[:10]}|cal:{c.source}:{c.created_at[:10]}"

    # ── one photo ───────────────────────────────────────────────────────────
    def analyse_view(self, data: bytes | Image.Image, equipment_type: str, *, check_quality: bool = True,
                     check_type: bool = True) -> tuple[ViewResult, dict, list[str]]:
        bank, cal = self.banks[equipment_type], self.calibrations[equipment_type]
        pre = preprocess(data, blur_threshold=cal.blur_threshold, check_quality=check_quality)
        feats, cls = self.extractor.extract([pre.image])
        tc = type_check(cls[0], equipment_type, self.banks, cal)
        if check_type and tc["is_wrong"]:
            best = tc["best_match"]
            msg = (f"This photo looks like a {C.EQUIPMENT_LABELS[best]}, not a {C.EQUIPMENT_LABELS[equipment_type]}."
                   if best != equipment_type else
                   f"This photo does not look like a {C.EQUIPMENT_LABELS[equipment_type]}.")
            raise PhotoError("WRONG_EQUIPMENT_TYPE", msg + " Check the selected equipment type.",
                             {"selected": equipment_type, "detected": best,
                              "similarities": {k: round(v, 3) for k, v in tc["similarities"].items()}})
        view = score_view(pre, feats[0], cls[0], bank, cal)
        return view, tc, pre.warnings

    # ── one item, 1-4 photos ────────────────────────────────────────────────
    def health_check(self, images: list[bytes], equipment_type: str) -> dict:
        if equipment_type not in C.EQUIPMENT_TYPES:
            raise ServiceError("UNSUPPORTED_EQUIPMENT_TYPE",
                               f"Equipment type must be one of: {', '.join(C.EQUIPMENT_TYPES)}.", status=400,
                               details={"received": equipment_type})
        if equipment_type not in self.banks:
            raise ServiceError("MODEL_NOT_READY",
                               f"No reference bank has been built for {C.EQUIPMENT_LABELS[equipment_type]} yet.",
                               details={"equipment_type": equipment_type})
        cal = self.calibrations[equipment_type]
        views, warnings, confidences = [], [], []
        for idx, data in enumerate(images):
            try:
                view, tc, warn = self.analyse_view(data, equipment_type)
            except PhotoError as e:
                e.details = {**e.details, "photo_index": idx}
                raise
            views.append(view)
            confidences.append(tc["confidence"])
            warnings += [f"photo {idx + 1}: {w}" for w in warn]

        agg = aggregate_views([v.score for v in views])
        label = label_for(agg["health_score"], cal.thresholds)
        worst = views[agg["worst_view_index"]]
        return {
            "equipment_type": equipment_type,
            "health_score": agg["health_score"],
            "label": label,
            "label_text": LABEL_TEXT[label],
            "advice": ADVICE[label],
            "anomaly_percent": agg["anomaly_percent"],
            "severity": agg["severity"],
            "confidence": round(float(min(confidences)), 3),
            "heatmap_image": to_jpeg_b64(worst.overlay),
            "processed_image": to_jpeg_b64(worst.processed),
            "worst_view_index": agg["worst_view_index"],
            "views": [
                {
                    "index": i,
                    "health_score": v.score.health,
                    "anomaly_percent": round(100 * v.score.coverage, 1),
                    "severity": round(v.score.severity, 3),
                    "heatmap_image": to_jpeg_b64(v.overlay, quality=80),
                }
                for i, v in enumerate(views)
            ],
            "thresholds": cal.thresholds,
            "warnings": warnings,
            "model_version": self.version_for(equipment_type),
        }
