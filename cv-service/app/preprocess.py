"""
Step 1 of the pipeline: BACKGROUND REPLACEMENT + photo quality checks.

The exact same function (`preprocess`) is used for:
  * the healthy reference photos (when building the memory of normal),
  * the test photos (when calibrating), and
  * every photo a coordinator uploads.
Using one function for all three is what makes the comparison fair.

What happens to a photo, in order:
  1. Decode the bytes, fix phone rotation (EXIF), convert to RGB.
  2. Shrink so the longest side is at most 1024 px (speed; no detail we need is lost).
  3. rembg (ISNet model) predicts, for every pixel, "is this the object?" (0-255).
  4. Clean that mask: keep the big pieces, drop specks, fill small holes.
  5. Quality gates: object found? not too dark? (blur is checked after step 7)
  6. Crop a square around the object with a 6% margin.
  7. Paste the object onto a plain grey canvas (the ImageNet mean colour).
  8. Resize to 448 x 448.  -> this is what DINOv2 sees.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from . import config as C


class PhotoError(Exception):
    """A problem with the photo that the coordinator can fix by retaking it."""

    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


@dataclass
class Preprocessed:
    image: Image.Image          # 448x448 RGB, object on plain grey background
    mask: np.ndarray            # 448x448 bool, True = object pixel
    patch_mask: np.ndarray      # 32x32 float, share of each patch covered by object
    blur_score: float           # variance of Laplacian inside the object (higher = sharper)
    brightness: float           # mean brightness of the object (0-255)
    object_fraction: float      # share of the original photo covered by the object
    warnings: list[str] = field(default_factory=list)


# ── 1. decoding ──────────────────────────────────────────────────────────────
def load_image(data: bytes) -> Image.Image:
    """Bytes -> upright RGB PIL image. Raises PhotoError(INVALID_IMAGE)."""
    if not data:
        raise PhotoError("INVALID_IMAGE", "The uploaded file is empty.")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise PhotoError("INVALID_IMAGE", "The file is not a readable JPG or PNG image.") from exc
    if img.format not in {"JPEG", "PNG", "WEBP", "MPO"}:
        raise PhotoError("INVALID_IMAGE", f"Unsupported image format '{img.format}'. Use JPG or PNG.")
    img = ImageOps.exif_transpose(img)          # phones store rotation in EXIF
    if img.mode in ("RGBA", "LA", "P"):
        # flatten any transparency onto white so the colours are stable
        canvas = Image.new("RGB", img.size, (255, 255, 255))
        canvas.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
        img = canvas
    img = img.convert("RGB")
    if min(img.size) < 256:
        raise PhotoError("IMAGE_TOO_SMALL", "The photo is too small. Use at least 1080 px on the short side.",
                         {"width": img.size[0], "height": img.size[1]})
    return img


def _shrink(img: Image.Image, max_side: int = C.MAX_INPUT_SIDE) -> Image.Image:
    w, h = img.size
    scale = max_side / max(w, h)
    if scale >= 1:
        return img
    return img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


# ── 3. background removal ────────────────────────────────────────────────────
_SESSION = None


def get_rembg_session():
    """Load the rembg model once and reuse it (loading takes ~1-2 s)."""
    global _SESSION
    if _SESSION is None:
        from rembg import new_session  # imported here so config env vars apply first
        _SESSION = new_session(C.REMBG_MODEL)
    return _SESSION


def predict_alpha(img: Image.Image) -> np.ndarray:
    """Return an HxW uint8 "objectness" map (255 = object, 0 = background)."""
    from rembg import remove
    cut = remove(img, session=get_rembg_session(), only_mask=True, post_process_mask=False)
    alpha = np.asarray(cut.convert("L"), dtype=np.uint8)
    return alpha


# ── 4. mask cleaning ─────────────────────────────────────────────────────────
def clean_mask(alpha: np.ndarray) -> np.ndarray:
    """Binary mask with specks removed and small holes filled."""
    mask = (alpha >= 128).astype(np.uint8)
    if mask.sum() == 0:
        return mask.astype(bool)

    # Keep every connected piece that is at least 5% the size of the biggest
    # piece (a strong highlight or seam can split the ball mask into parts).
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = np.zeros_like(mask)
    biggest = areas.max()
    for i, area in enumerate(areas, start=1):
        if area >= 0.05 * biggest:
            keep[labels == i] = 1

    # Fill holes (glare spots, shiny panels mistaken for background) that are
    # smaller than 5% of the object, so the object keeps its real appearance.
    inv = (1 - keep).astype(np.uint8)
    n2, labels2, stats2, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    h, w = keep.shape
    obj_area = keep.sum()
    for i in range(1, n2):
        x, y, bw, bh, area = stats2[i]
        touches_border = x == 0 or y == 0 or x + bw >= w or y + bh >= h
        if not touches_border and area < 0.05 * obj_area:
            keep[labels2 == i] = 1

    # Light closing to smooth jagged edges.
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return keep.astype(bool)


# ── helpers for the quality gates ────────────────────────────────────────────
def blur_score(gray: np.ndarray, mask: np.ndarray) -> float:
    """Variance of the Laplacian inside the object (edge sharpness).

    The Laplacian highlights edges and fine texture. A sharp photo has many
    strong edges -> high variance; a blurry photo has soft edges -> low
    variance. The mask is shrunk first so the artificial object/background
    border does not count as "texture".
    """
    inner = cv2.erode(mask.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    if inner.sum() < 500:
        inner = mask
    lap = cv2.Laplacian(gray.astype(np.float32), cv2.CV_32F, ksize=3)
    return float(lap[inner].var()) if inner.any() else 0.0


def _border_touch_sides(mask: np.ndarray, min_share: float = 0.10) -> int:
    sides = [mask[0, :], mask[-1, :], mask[:, 0], mask[:, -1]]
    return sum(float(s.mean()) > min_share for s in sides)


def _square_crop_box(mask: np.ndarray, pad: float) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    side = max(y1 - y0, x1 - x0)
    side = int(round(side * (1 + 2 * pad)))
    cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
    top, left = int(round(cy - side / 2)), int(round(cx - side / 2))
    return left, top, left + side, top + side


def _crop_with_fill(arr: np.ndarray, box: tuple[int, int, int, int], fill) -> np.ndarray:
    """Crop that may extend outside the image; outside is filled with `fill`."""
    l, t, r, b = box
    h, w = arr.shape[:2]
    out_shape = (b - t, r - l) + arr.shape[2:]
    out = np.empty(out_shape, dtype=arr.dtype)
    out[...] = fill
    sl, st, sr, sb = max(l, 0), max(t, 0), min(r, w), min(b, h)
    out[st - t:sb - t, sl - l:sr - l] = arr[st:sb, sl:sr]
    return out


# ── main entry point ─────────────────────────────────────────────────────────
def preprocess(data: bytes | Image.Image, *, blur_threshold: float | None = None,
               check_quality: bool = True) -> Preprocessed:
    """Run steps 1-8. Raises PhotoError when the photo cannot be used."""
    img = data if isinstance(data, Image.Image) else load_image(data)
    img = _shrink(img.convert("RGB"))
    rgb = np.asarray(img, dtype=np.uint8)

    mask = clean_mask(predict_alpha(img))
    frac = float(mask.mean())
    warnings: list[str] = []

    # Gate: was an object found at all?
    if frac < C.MIN_OBJECT_FRACTION:
        raise PhotoError("NO_OBJECT_DETECTED",
                         "No equipment was found in the photo. Place the item in the centre of a plain background.",
                         {"object_fraction": round(frac, 4)})
    if frac > C.MAX_OBJECT_FRACTION:
        raise PhotoError("NO_OBJECT_DETECTED",
                         "The item could not be separated from the background. Step back and use a plain background.",
                         {"object_fraction": round(frac, 4)})
    if _border_touch_sides(mask) >= 2:
        warnings.append("ITEM_MAY_BE_CUT_OFF")

    # Gate: brightness of the object itself.
    gray_full = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    brightness = float(gray_full[mask].mean())
    if check_quality and brightness < C.MIN_BRIGHTNESS:
        raise PhotoError("TOO_DARK", "The photo is too dark. Retake it in better light (no flash).",
                         {"brightness": round(brightness, 1), "minimum": C.MIN_BRIGHTNESS})

    # Steps 6-7: square crop around the object, composite onto plain grey.
    box = _square_crop_box(mask, C.CROP_PADDING)
    crop_rgb = _crop_with_fill(rgb, box, np.array(C.BG_COLOR, dtype=np.uint8))
    crop_mask = _crop_with_fill(mask.astype(np.uint8), box, 0)

    # Step 8: resize image and mask to the standard size.
    S = C.IMAGE_SIZE
    rgb448 = cv2.resize(crop_rgb, (S, S), interpolation=cv2.INTER_AREA)
    mask448 = cv2.resize(crop_mask.astype(np.float32), (S, S), interpolation=cv2.INTER_AREA)
    alpha = cv2.GaussianBlur(mask448, (3, 3), 0)[..., None]          # soft edge
    bg = np.empty_like(rgb448)
    bg[...] = C.BG_COLOR
    comp = (rgb448.astype(np.float32) * alpha + bg.astype(np.float32) * (1 - alpha))
    comp = np.clip(comp + 0.5, 0, 255).astype(np.uint8)
    mask_bool = mask448 >= 0.5

    # Share of each 14x14 patch that is object (32 x 32 grid).
    P = C.PATCH_SIZE
    patch_mask = mask448.reshape(C.GRID, P, C.GRID, P).mean(axis=(1, 3))

    # Gate: sharpness, measured at the standard size so it is comparable.
    gray448 = cv2.cvtColor(comp, cv2.COLOR_RGB2GRAY)
    blur = blur_score(gray448, mask_bool)
    thr = C.DEFAULT_BLUR_THRESHOLD if blur_threshold is None else blur_threshold
    if check_quality and blur < thr:
        raise PhotoError("BLURRY_IMAGE", "The photo is blurry. Hold the phone steady, tap to focus and retake it.",
                         {"blur_score": round(blur, 1), "minimum": round(thr, 1)})

    if (patch_mask >= C.PATCH_OBJECT_MIN).sum() < 20:
        raise PhotoError("NO_OBJECT_DETECTED", "The item is too small or too thin in the photo. Move closer.",
                         {"object_patches": int((patch_mask >= C.PATCH_OBJECT_MIN).sum())})

    return Preprocessed(
        image=Image.fromarray(comp), mask=mask_bool, patch_mask=patch_mask,
        blur_score=blur, brightness=brightness, object_fraction=frac, warnings=warnings,
    )


def apply_augmentation(pre: Preprocessed, aug: str) -> Preprocessed:
    """Rotate/flip a preprocessed image AND its masks together (bank building only)."""
    img = np.asarray(pre.image)
    m, pm = pre.mask, pre.patch_mask
    if aug == "rot0":
        return pre
    if aug.startswith("rot"):
        k = int(aug[3:]) // 90
        img, m, pm = np.rot90(img, k), np.rot90(m, k), np.rot90(pm, k)
    elif aug == "hflip":
        img, m, pm = img[:, ::-1], m[:, ::-1], pm[:, ::-1]
    else:
        raise ValueError(f"unknown augmentation {aug}")
    return Preprocessed(image=Image.fromarray(np.ascontiguousarray(img)), mask=np.ascontiguousarray(m),
                        patch_mask=np.ascontiguousarray(pm), blur_score=pre.blur_score,
                        brightness=pre.brightness, object_fraction=pre.object_fraction, warnings=[])
