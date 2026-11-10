"""
Central configuration for the Equipment Health Check CV service.

Every "magic number" used by the pipeline lives here, with a comment saying
what it means, so the team can find and tune things in one place.

IMPORTANT: this module sets two environment variables (U2NET_HOME, HF_HOME)
that tell the background-removal library and the DINOv2 loader where to keep
their downloaded model files. It must be imported BEFORE `rembg` or
`transformers` are imported anywhere — every other module imports it first.
"""
from __future__ import annotations

import os
from pathlib import Path

# ── Folders ──────────────────────────────────────────────────────────────────
# cv-service/ (the folder that contains app/, scripts/, banks/, models/)
BASE_DIR = Path(__file__).resolve().parent.parent

# Where downloaded model weights are cached so the service works offline
# after the first download (see scripts/download_models.py).
MODELS_DIR = Path(os.getenv("CV_MODELS_DIR", BASE_DIR / "models"))
os.environ.setdefault("U2NET_HOME", str(MODELS_DIR / "rembg"))   # rembg weights
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))         # DINOv2 weights

# Where the "memory of normal" (one reference bank per equipment type) lives.
BANKS_DIR = Path(os.getenv("CV_BANKS_DIR", BASE_DIR / "banks"))

# Where the photo dataset lives (see the guide, section 2).
DATASET_DIR = Path(os.getenv("CV_DATASET_DIR", BASE_DIR / "dataset"))

# ── Equipment in scope (ONLY these three) ────────────────────────────────────
EQUIPMENT_TYPES: tuple[str, ...] = ("basketball", "football", "volleyball")
EQUIPMENT_LABELS = {
    "basketball": "Basketball",
    "football": "Football",
    "volleyball": "Volleyball",
}

# ── Models (fixed decisions) ─────────────────────────────────────────────────
# DINOv2 ViT-S/14 ("small", 21M parameters) — frozen, never fine-tuned.
DINO_MODEL_ID = os.getenv("CV_DINO_MODEL", "facebook/dinov2-small")
# rembg background-removal model. ISNet ("isnet-general-use") is built for
# fine structures — important for clean ball outlines, seams and valve edges.
REMBG_MODEL = os.getenv("CV_REMBG_MODEL", "isnet-general-use")

# ── Standard image geometry ──────────────────────────────────────────────────
IMAGE_SIZE = 448          # every image becomes 448 x 448 pixels before DINOv2
PATCH_SIZE = 14           # DINOv2 cuts the image into 14 x 14 pixel patches
GRID = IMAGE_SIZE // PATCH_SIZE   # 448 / 14 = 32 -> a 32 x 32 grid = 1024 patches
# Uniform background colour = the ImageNet mean colour. After DINOv2's
# normalisation this colour becomes exactly 0, i.e. "nothing to see here".
BG_COLOR = (124, 116, 104)
MAX_INPUT_SIDE = 1024     # photos are shrunk to this longest side first (speed)
CROP_PADDING = 0.06       # 6% empty margin around the object after cropping
PATCH_OBJECT_MIN = 0.5    # a patch counts as "object" if >= 50% of it is object

# ── Upload limits ────────────────────────────────────────────────────────────
MAX_IMAGES_PER_REQUEST = 4          # up to 4 angles of the same item
MAX_IMAGE_BYTES = 8 * 1024 * 1024   # 8 MB per photo

# ── Photo quality gates (used for the error messages) ────────────────────────
MIN_OBJECT_FRACTION = 0.02   # object must cover >= 2% of the photo
MAX_OBJECT_FRACTION = 0.97   # if "object" is > 97% the background was not separated
MIN_BRIGHTNESS = 50.0        # mean brightness of the object (0-255); below = too dark
DEFAULT_BLUR_THRESHOLD = 12.0  # variance-of-Laplacian; below = blurry (calibrated per type)

# ── Anomaly scoring ──────────────────────────────────────────────────────────
SMOOTHING_SIGMA = 1.0     # Gaussian smoothing of the 32x32 distance map (in patches)
TOPK_FRACTION = 0.01      # severity = mean of the worst 1% of object patches
TOPK_MIN = 3              # ...but never fewer than 3 patches
MAX_BANK_PATCHES = 30000  # coreset size cap per equipment type (keeps search fast)
CORESET_PROJ_DIM = 128    # random projection size used only while picking the coreset

# Rotations / flips added to the reference photos when building the bank.
# Balls look the same when rotated, so all four rotations are "normal"
# (all three equipment types are balls).
AUGMENTATIONS = {
    "basketball": ["rot0", "rot90", "rot180", "rot270"],
    "football": ["rot0", "rot90", "rot180", "rot270"],
    "volleyball": ["rot0", "rot90", "rot180", "rot270"],
}

# ── Health score defaults (replaced per type by scripts/calibrate.py) ────────
DEFAULT_WEIGHT_SEVERITY = 0.6   # w_S
DEFAULT_WEIGHT_COVERAGE = 0.4   # w_C
DEFAULT_COVERAGE_FULL = 0.25    # C_full: 25% of the surface affected = max coverage penalty
DEFAULT_SEVERE_MARGIN = 0.20    # d_severe = tau + 0.20 until calibrated
DEFAULT_THRESHOLDS = {"good": 80, "fair": 60, "poor": 40}   # score -> label cut-offs
MULTI_VIEW_MIN_WEIGHT = 0.7     # item score = 0.7 * worst view + 0.3 * average view

# ── Wrong-equipment check ────────────────────────────────────────────────────
TYPE_CHECK_MARGIN = 0.02        # another type must win by at least this much
TYPE_SOFTMAX_TEMPERATURE = 0.05

# ── Performance ──────────────────────────────────────────────────────────────
TORCH_THREADS = int(os.getenv("CV_TORCH_THREADS", str(os.cpu_count() or 4)))
BANK_BUILD_BATCH = 4

# Optional shared secret. If set, every request must send header X-CV-Key.
API_KEY = os.getenv("CV_API_KEY", "")
