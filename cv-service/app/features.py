"""
Step 2 of the pipeline: DINOv2 as a FROZEN feature extractor.

DINOv2 ViT-S/14 reads a 448x448 image as a 32x32 grid of 14x14-pixel patches
and returns, for every patch, a list of 384 numbers (a "patch feature") that
describes what that small square looks like in context. We never train or
fine-tune it: `model.eval()` + `torch.inference_mode()` and no optimiser.

We also keep the CLS token — one 384-number summary of the whole image — which
is used only for the "is this really a basketball?" check.
"""
from __future__ import annotations

import threading

import numpy as np
import torch
from PIL import Image

from . import config as C

# ImageNet normalisation used when DINOv2 was trained.
_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


class DinoFeatureExtractor:
    """Loads DINOv2 once and turns 448x448 images into patch features."""

    def __init__(self, model_id: str = C.DINO_MODEL_ID):
        from transformers import Dinov2Model  # imported late so HF_HOME from config applies

        torch.set_num_threads(C.TORCH_THREADS)
        self.model_id = model_id
        self.model = Dinov2Model.from_pretrained(model_id)
        self.model.eval()                      # frozen: no dropout, no training
        for p in self.model.parameters():      # and no gradients, ever
            p.requires_grad_(False)
        self.dim = int(self.model.config.hidden_size)   # 384 for ViT-S
        self._lock = threading.Lock()         # one inference at a time (CPU threads are shared)

    @staticmethod
    def _to_tensor(images: list[Image.Image]) -> torch.Tensor:
        arr = np.stack([np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0 for im in images])
        t = torch.from_numpy(arr).permute(0, 3, 1, 2)          # B x 3 x H x W
        return (t - _MEAN) / _STD

    @torch.inference_mode()
    def extract(self, images: list[Image.Image]) -> tuple[np.ndarray, np.ndarray]:
        """Return (patch_features [B, 1024, 384], cls [B, 384]); both L2-normalised.

        L2-normalising means every feature has length 1, so the dot product of
        two features is their cosine similarity (1 = identical look, 0 = unrelated).
        """
        for im in images:
            if im.size != (C.IMAGE_SIZE, C.IMAGE_SIZE):
                raise ValueError(f"expected {C.IMAGE_SIZE}x{C.IMAGE_SIZE} input, got {im.size}")
        x = self._to_tensor(images)
        with self._lock:
            out = self.model(pixel_values=x)
        tokens = out.last_hidden_state                 # B x (1 + 1024) x 384 (already layer-normed)
        cls = tokens[:, 0, :]
        patches = tokens[:, 1:, :]
        n = patches.shape[1]
        if n != C.GRID * C.GRID:
            raise RuntimeError(f"expected {C.GRID * C.GRID} patches, got {n}")
        patches = torch.nn.functional.normalize(patches, dim=-1)
        cls = torch.nn.functional.normalize(cls, dim=-1)
        return patches.numpy().astype(np.float32), cls.numpy().astype(np.float32)

    def extract_batched(self, images: list[Image.Image], batch: int = C.BANK_BUILD_BATCH):
        feats, clss = [], []
        for i in range(0, len(images), batch):
            f, c = self.extract(images[i:i + batch])
            feats.append(f)
            clss.append(c)
        return np.concatenate(feats), np.concatenate(clss)


_EXTRACTOR: DinoFeatureExtractor | None = None


def get_extractor() -> DinoFeatureExtractor:
    global _EXTRACTOR
    if _EXTRACTOR is None:
        _EXTRACTOR = DinoFeatureExtractor()
    return _EXTRACTOR
