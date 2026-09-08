from __future__ import annotations

import logging
import os
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from capture_pipeline import capture_from_barcode_scan, capture_from_manual_entry, serialize_capture, to_apex_stop_demand, to_mercury_intake_payload
from manual_review import claim_review, enqueue_review, init_review_store, list_reviews, resolve_review

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ung.mercury")

app = FastAPI(title="UNG-MERCURY", version="0.1.1")

@app.on_event("startup")
def startup():
    init_review_store()
    log.info("MERCURY startup complete")

class BarcodeCaptureIn(BaseModel):
    tracking_number: str
    weight_kg: float | None = None
    station_id: str
    device_id: str
    operator_id: str
    idempotency_key: str | None = None

class ManualCaptureIn(BaseModel):
    tracking_number: str | None = None
    destination_code: str | None = None
    destination_type: str | None = None
    weight_kg: float | None = None
    station_id: str
    device_id: str
    operator_id: str
    idempotency_key: str | None = None

class ClaimIn(BaseModel):
    operator_id: str

class ResolveIn(BaseModel):
    operator_id: str
    resolution: str = Field(min_length=1, max_length=500)

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "UNG-MERCURY",
        "name": "Package Intake & Sorting",
        "version": "0.1.1",
        "health": "/health",
        "readiness": "/ready",
        "system": "/v1/system",
        "api_docs": "/docs",
        "capture": {"barcode": "/v1/captures/barcode", "manual": "/v1/captures/manual"},
        "manual_review": "/v1/manual-review"
    }

@app.get("/health")
def health():
    return {"status": "ok", "service": "UNG-MERCURY", "version": "0.1.1"}

@app.get("/ready")
def ready():
    try:
        init_review_store()
        return {"status": "ready", "manual_review_store": "connected"}
    except Exception as exc:
        log.exception("readiness failure")
        raise HTTPException(503, f"manual_review_store_unavailable:{type(exc).__name__}")

@app.get("/v1/system")
def system():
    return {
        "system_id": "UNG-MERCURY",
        "domain": "package-intake-sorting",
        "capabilities": ["barcode-capture", "manual-capture", "idempotency", "capture-provenance", "weight-validation", "manual-review-queue", "apex-demand-mapping", "structured-logging"],
    }

@app.post("/v1/captures/barcode", status_code=201)
def barcode_capture(body: BarcodeCaptureIn):
    try:
        capture = capture_from_barcode_scan(**body.model_dump())
    except ValueError as exc:
        log.warning("barcode capture rejected: %s", exc)
        raise HTTPException(422, str(exc))
    payload = serialize_capture(capture)
    log.info("barcode capture accepted capture_id=%s station=%s operator=%s", capture.capture_id, capture.station_id, capture.operator_id)
    return {"capture": payload, "mercury_intake": to_mercury_intake_payload(capture, capture.station_id, capture.operator_id), "apex_demand": to_apex_stop_demand(capture)}

@app.post("/v1/captures/manual", status_code=201)
def manual_capture(body: ManualCaptureIn):
    try:
        capture = capture_from_manual_entry(**body.model_dump())
    except ValueError as exc:
        log.warning("manual capture rejected: %s", exc)
        raise HTTPException(422, str(exc))
    payload = serialize_capture(capture)
    review = enqueue_review(payload, "manual_capture_requires_review")
    log.info("manual capture queued capture_id=%s review_id=%s duplicate=%s", capture.capture_id, review.get("review_id"), review.get("duplicate"))
    return {"capture": payload, "manual_review": review, "apex_demand": to_apex_stop_demand(capture)}

@app.get("/v1/manual-review")
def manual_review(status: str = "open", limit: int = Query(100, ge=1, le=500)):
    return {"results": list_reviews(status=status, limit=limit)}

@app.post("/v1/manual-review/{review_id}/claim")
def review_claim(review_id: str, body: ClaimIn):
    row = claim_review(review_id, body.operator_id)
    if not row:
        raise HTTPException(404, "review_not_found")
    return row

@app.post("/v1/manual-review/{review_id}/resolve")
def review_resolve(review_id: str, body: ResolveIn):
    row = resolve_review(review_id, body.operator_id, body.resolution)
    if not row:
        raise HTTPException(404, "review_not_found")
    return row
