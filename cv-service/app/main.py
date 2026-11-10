"""
FastAPI microservice — Equipment Health Check.

Run (from the cv-service folder, with the virtual environment active):
    uvicorn app.main:app --host 127.0.0.1 --port 8001

Endpoints
  GET  /health                 -> is the service up, which equipment types are ready
  POST /v1/health-check        -> multipart form:
                                    equipment_type = basketball | football | volleyball
                                    images         = 1..4 photo files (JPG/PNG) of ONE item
                                  returns health_score, label, anomaly_percent, heatmap_image, ...

Errors always look like:  {"error": {"code": "...", "message": "...", "details": {...}}}
  400 UNSUPPORTED_EQUIPMENT_TYPE  type not one of the three
  400 NO_IMAGES / TOO_MANY_IMAGES
  413 IMAGE_TOO_LARGE             a photo over 8 MB
  415 INVALID_IMAGE               not a readable JPG/PNG
  422 BLURRY_IMAGE | TOO_DARK | NO_OBJECT_DETECTED | IMAGE_TOO_SMALL | WRONG_EQUIPMENT_TYPE
  401 UNAUTHORIZED                CV_API_KEY is set and the header X-CV-Key is wrong
  503 MODEL_NOT_READY             no reference bank built for that type yet
"""
from __future__ import annotations

from . import config as C  # noqa: I001  (must be first: sets model cache folders)

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Header, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .pipeline import Engine, ServiceError
from .preprocess import PhotoError, get_rembg_session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("cv.api")

PHOTO_ERROR_STATUS = {"INVALID_IMAGE": 415}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the heavy things ONCE at start-up (not per request): DINOv2, rembg, banks.
    t0 = time.perf_counter()
    app.state.engine = Engine.load()
    get_rembg_session()
    log.info("models ready in %.1fs; banks: %s", time.perf_counter() - t0, list(app.state.engine.banks))
    yield


app = FastAPI(title="BUKC Equipment Health Check (CV)", version="1.0.0", lifespan=lifespan)


def err(status: int, code: str, message: str, details: dict | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message,
                                                               "details": details or {}}})


@app.exception_handler(PhotoError)
async def _photo_error(_: Request, e: PhotoError):
    return err(PHOTO_ERROR_STATUS.get(e.code, 422), e.code, e.message, e.details)


@app.exception_handler(ServiceError)
async def _service_error(_: Request, e: ServiceError):
    return err(e.status, e.code, e.message, e.details)


@app.get("/health")
def health():
    eng: Engine = app.state.engine
    return {
        "status": "ok",
        "model": eng.model_version,
        "equipment_types": {
            t: {"ready": t in eng.banks,
                "bank_patches": eng.banks[t].size if t in eng.banks else 0,
                "calibration": eng.calibrations[t].source if t in eng.calibrations else None}
            for t in C.EQUIPMENT_TYPES
        },
    }


@app.post("/v1/health-check")
async def health_check(
    equipment_type: str = Form(..., description="basketball | football | volleyball"),
    images: list[UploadFile] = File(..., description="1 to 4 photos (angles) of the same item"),
    x_cv_key: str | None = Header(default=None),
):
    if C.API_KEY and x_cv_key != C.API_KEY:
        return err(401, "UNAUTHORIZED", "Missing or wrong X-CV-Key header.")

    equipment_type = equipment_type.strip().lower().replace(" ", "_").replace("-", "_")
    if equipment_type not in C.EQUIPMENT_TYPES:
        return err(400, "UNSUPPORTED_EQUIPMENT_TYPE",
                   f"Equipment type must be one of: {', '.join(C.EQUIPMENT_TYPES)}.", {"received": equipment_type})
    if not images:
        return err(400, "NO_IMAGES", "Upload at least one photo.")
    if len(images) > C.MAX_IMAGES_PER_REQUEST:
        return err(400, "TOO_MANY_IMAGES", f"Upload at most {C.MAX_IMAGES_PER_REQUEST} photos of one item.")

    blobs: list[bytes] = []
    for i, f in enumerate(images):
        data = await f.read(C.MAX_IMAGE_BYTES + 1)
        if len(data) > C.MAX_IMAGE_BYTES:
            return err(413, "IMAGE_TOO_LARGE", "Each photo must be 8 MB or smaller.", {"photo_index": i})
        blobs.append(data)

    t0 = time.perf_counter()
    # The model work is CPU-heavy and blocking -> run it in a worker thread so the
    # server stays responsive. Engine/feature extractor serialise inference internally.
    result = await run_in_threadpool(app.state.engine.health_check, blobs, equipment_type)
    result["processing_ms"] = int((time.perf_counter() - t0) * 1000)
    log.info("health-check %s x%d -> %s (%s) in %dms", equipment_type, len(blobs), result["health_score"],
             result["label"], result["processing_ms"])
    return result
