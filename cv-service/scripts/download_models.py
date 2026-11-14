"""
Download both models ONCE (needs internet), so the service then runs offline.

    python -m scripts.download_models

Saves:
  models/hf/      DINOv2 ViT-S/14  (facebook/dinov2-small, ~88 MB)
  models/rembg/   ISNet background remover (isnet-general-use.onnx, ~170 MB)

After this, set HF_HUB_OFFLINE=1 (see .env.example) and no internet is needed.
"""
from app import config as C  # noqa: F401  (sets HF_HOME / U2NET_HOME first)

from app.features import DinoFeatureExtractor
from app.preprocess import get_rembg_session


def main() -> None:
    print(f"Downloading DINOv2 '{C.DINO_MODEL_ID}' into {C.MODELS_DIR / 'hf'} ...")
    ext = DinoFeatureExtractor()
    print(f"  ok - hidden size {ext.dim}")
    print(f"Downloading rembg '{C.REMBG_MODEL}' into {C.MODELS_DIR / 'rembg'} ...")
    get_rembg_session()
    print("  ok")
    print("Done. The service can now run offline (set HF_HUB_OFFLINE=1).")


if __name__ == "__main__":
    main()
