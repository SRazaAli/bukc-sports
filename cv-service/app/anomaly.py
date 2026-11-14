"""
Step 3 of the pipeline: UNSUPERVISED ANOMALY DETECTION with a "memory of normal".

Building (offline, once per equipment type — scripts/build_bank.py):
  * preprocess every HEALTHY reference photo (+ rotations/flips),
  * run DINOv2, keep the patch features that sit on the object,
  * squeeze them to at most 30,000 representative patches (a "coreset"),
  * save them as banks/<type>/bank.npy  -> the memory of normal.

Scoring (online, every upload):
  * preprocess the photo exactly the same way and run DINOv2,
  * for each object patch find the MOST SIMILAR healthy patch in the bank,
  * distance = 1 - cosine similarity  (0 = "I've seen this before", big = "never seen"),
  * smooth the 32x32 distance map a little (single noisy patches fade, real damage stays),
  * hand the distances to health_score.py and draw the heatmap overlay.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from . import config as C
from .health_score import Calibration, ViewScore, patch_severity, score_from_distances
from .preprocess import Preprocessed


# ── memory bank ──────────────────────────────────────────────────────────────
@dataclass
class ReferenceBank:
    equipment_type: str
    features: torch.Tensor   # M x 384, float16 on disk, float32 in memory for speed
    prototype: np.ndarray    # 384, mean CLS feature of the healthy photos (for the type check)
    meta: dict

    @property
    def size(self) -> int:
        return int(self.features.shape[0])

    @classmethod
    def load(cls, folder: Path) -> "ReferenceBank":
        folder = Path(folder)
        feats = np.load(folder / "bank.npy").astype(np.float32)
        proto = np.load(folder / "prototype.npy").astype(np.float32)
        meta = json.loads((folder / "bank_meta.json").read_text())
        return cls(meta["equipment_type"], torch.from_numpy(feats), proto, meta)

    def save(self, folder: Path) -> None:
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        np.save(folder / "bank.npy", self.features.numpy().astype(np.float16))
        np.save(folder / "prototype.npy", self.prototype.astype(np.float32))
        (folder / "bank_meta.json").write_text(json.dumps(self.meta, indent=2))


def object_patch_features(patch_feats: np.ndarray, pre: Preprocessed) -> np.ndarray:
    """Keep only the features of patches that are mostly object (drop plain background)."""
    keep = pre.patch_mask.reshape(-1) >= C.PATCH_OBJECT_MIN
    return patch_feats[keep]


def greedy_coreset(features: torch.Tensor, target: int, proj_dim: int = C.CORESET_PROJ_DIM,
                   seed: int = 0) -> torch.Tensor:
    """Pick `target` patches that cover the whole bank as evenly as possible.

    Greedy k-center (as in PatchCore): start from one patch, then repeatedly
    add the patch that is FARTHEST from everything picked so far. Rare-but-
    normal looks (a logo, the valve) are therefore kept, while thousands of
    near-identical "plain orange leather" patches are thinned out.
    Distances are computed on a random 128-d projection only to save time.
    """
    n = features.shape[0]
    if n <= target:
        return torch.arange(n)
    g = torch.Generator().manual_seed(seed)
    proj = torch.randn(features.shape[1], proj_dim, generator=g) / proj_dim ** 0.5
    z = features @ proj
    selected = torch.empty(target, dtype=torch.long)
    idx = int(torch.randint(n, (1,), generator=g))
    min_d = torch.full((n,), float("inf"))
    for i in range(target):
        selected[i] = idx
        d = ((z - z[idx]) ** 2).sum(dim=1)
        min_d = torch.minimum(min_d, d)
        idx = int(torch.argmax(min_d))
    return selected


@torch.inference_mode()
def nearest_distances(query: np.ndarray, bank: torch.Tensor, chunk: int = 8192) -> np.ndarray:
    """For every query patch: 1 - (highest cosine similarity to any bank patch).

    Both sides are L2-normalised, so cosine similarity is a plain dot product.
    The bank is processed in chunks so memory stays small on a laptop.
    """
    q = torch.from_numpy(np.ascontiguousarray(query, dtype=np.float32))
    best = torch.full((q.shape[0],), -1.0)
    for start in range(0, bank.shape[0], chunk):
        sims = q @ bank[start:start + chunk].T
        best = torch.maximum(best, sims.max(dim=1).values)
    return (1.0 - best).clamp(min=0.0).numpy()


def smooth_map(dist_map: np.ndarray, patch_mask: np.ndarray, sigma: float = C.SMOOTHING_SIGMA) -> np.ndarray:
    """Gaussian smoothing over object patches only (normalised convolution).

    A single odd patch (a reflection, a speck of dust) is averaged with its
    neighbours and fades; a real scuff spans several patches and survives.
    Background patches do not drag the edge of the object towards zero.
    """
    w = (patch_mask >= C.PATCH_OBJECT_MIN).astype(np.float32)
    num = cv2.GaussianBlur(dist_map.astype(np.float32) * w, (0, 0), sigma, borderType=cv2.BORDER_CONSTANT)
    den = cv2.GaussianBlur(w, (0, 0), sigma, borderType=cv2.BORDER_CONSTANT)
    out = np.where(den > 1e-6, num / np.maximum(den, 1e-6), 0.0)
    return (out * w).astype(np.float32)


def distance_map(patch_feats: np.ndarray, pre: Preprocessed, bank: ReferenceBank) -> np.ndarray:
    """32x32 map of smoothed nearest-healthy-patch distances (0 on the background)."""
    keep = pre.patch_mask.reshape(-1) >= C.PATCH_OBJECT_MIN
    raw = np.zeros(C.GRID * C.GRID, dtype=np.float32)
    raw[keep] = nearest_distances(patch_feats[keep], bank.features)
    return smooth_map(raw.reshape(C.GRID, C.GRID), pre.patch_mask)


# ── heatmap overlay ──────────────────────────────────────────────────────────
def heatmap_overlay(pre: Preprocessed, sev_map: np.ndarray, anomalous: np.ndarray) -> Image.Image:
    """Colour the anomalous areas (yellow -> red by severity) on top of the photo.

    Only patches above tau are coloured, so a healthy item shows a clean image.
    A thin white outline marks each anomalous region.
    """
    S = C.IMAGE_SIZE
    base = np.asarray(pre.image).astype(np.float32)
    sev = cv2.resize(sev_map.astype(np.float32), (S, S), interpolation=cv2.INTER_CUBIC)
    sev = np.clip(sev, 0, 1) * pre.mask
    show = cv2.resize(anomalous.astype(np.float32), (S, S), interpolation=cv2.INTER_LINEAR) * pre.mask
    # JET colour scale: 0.62 = yellow (mild) ... 1.0 = red (severe)
    lut_in = (255 * (0.62 + 0.38 * sev)).astype(np.uint8)
    colour = cv2.applyColorMap(lut_in, cv2.COLORMAP_JET)[..., ::-1].astype(np.float32)  # BGR -> RGB
    alpha = (0.35 + 0.35 * sev) * np.clip(show * 1.5, 0, 1)
    out = base * (1 - alpha[..., None]) + colour * alpha[..., None]
    out = np.clip(out, 0, 255).astype(np.uint8)
    region = (show >= 0.5).astype(np.uint8)
    if region.any():
        contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(out, contours, -1, (255, 255, 255), 1, lineType=cv2.LINE_AA)
    return Image.fromarray(out)


# ── one photo, end to end (after preprocessing + DINOv2) ─────────────────────
@dataclass
class ViewResult:
    score: ViewScore
    dist_map: np.ndarray        # 32x32 smoothed distances
    sev_map: np.ndarray         # 32x32 severities 0..1
    overlay: Image.Image        # heatmap on the processed photo
    processed: Image.Image      # processed photo (object on grey)
    cls: np.ndarray             # 384 global feature (type check)


def score_view(pre: Preprocessed, patch_feats: np.ndarray, cls: np.ndarray,
               bank: ReferenceBank, cal: Calibration) -> ViewResult:
    dmap = distance_map(patch_feats, pre, bank)
    obj = pre.patch_mask >= C.PATCH_OBJECT_MIN
    vs = score_from_distances(dmap[obj], cal)
    sev = patch_severity(dmap, cal) * obj
    anomalous = (dmap > cal.tau) & obj
    return ViewResult(score=vs, dist_map=dmap, sev_map=sev, overlay=heatmap_overlay(pre, sev, anomalous),
                      processed=pre.image, cls=cls)


# ── wrong-equipment check ────────────────────────────────────────────────────
def type_check(cls: np.ndarray, selected: str, banks: dict[str, ReferenceBank],
               cal: Calibration) -> dict:
    """Compare the photo's global feature with each type's healthy 'average look'."""
    sims = {t: float(np.dot(cls, b.prototype) / (np.linalg.norm(b.prototype) + 1e-8)) for t, b in banks.items()}
    best = max(sims, key=sims.get)
    names = list(sims)
    logits = np.array([sims[t] for t in names]) / C.TYPE_SOFTMAX_TEMPERATURE
    probs = np.exp(logits - logits.max())
    probs /= probs.sum()
    conf = float(probs[names.index(selected)]) if len(names) > 1 else \
        float(np.clip((sims[selected] - cal.type_min_similarity) / max(1 - cal.type_min_similarity, 1e-6), 0, 1))
    wrong_by_rank = best != selected and sims[best] - sims[selected] > C.TYPE_CHECK_MARGIN
    wrong_by_floor = sims[selected] < cal.type_min_similarity
    return {"similarities": sims, "best_match": best, "confidence": conf,
            "is_wrong": bool(wrong_by_rank or wrong_by_floor)}
