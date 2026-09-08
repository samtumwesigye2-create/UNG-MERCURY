from __future__ import annotations

import logging
import os
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from capture_pipeline import capture_from_barcode_scan, capture_from_manual_entry, serialize_capture, to_apex_stop_demand, to_mercury_intake_payload
from idempotency_store import get_idempotent_response, init_idempotency_store, store_idempotent_response
from integrations import resolve_zipper, zipper_health
from manual_review import claim_review, enqueue_review, init_review_store, list_reviews, resolve_review

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ung.mercury")
app = FastAPI(title="UNG-MERCURY", version="0.3.0")
UI_PATH = Path(__file__).with_name("ui.html")

@app.on_event("startup")
def startup():
    init_review_store(); init_idempotency_store(); log.info("MERCURY startup complete")

class BarcodeCaptureIn(BaseModel):
    tracking_number: str; weight_kg: float | None = None; station_id: str; device_id: str; operator_id: str; idempotency_key: str | None = None
class ManualCaptureIn(BaseModel):
    tracking_number: str | None = None; destination_code: str | None = None; destination_type: str | None = None; weight_kg: float | None = None; station_id: str; device_id: str; operator_id: str; idempotency_key: str | None = None
class ClaimIn(BaseModel): operator_id: str
class ResolveIn(BaseModel): operator_id: str; resolution: str = Field(min_length=1,max_length=500)

@app.get("/",include_in_schema=False)
def root(): return FileResponse(UI_PATH,media_type="text/html")
@app.get("/health")
def health(): return {"status":"ok","service":"UNG-MERCURY","version":"0.3.0"}
@app.get("/ready")
def ready():
    try:
        init_review_store(); init_idempotency_store(); z=zipper_health()
        return {"status":"ready","manual_review_store":"connected","idempotency_store":"connected","zipper":"connected" if z.get("ok") else "degraded"}
    except Exception as exc: raise HTTPException(503,f"mercury_store_unavailable:{type(exc).__name__}")
@app.get("/v1/system")
def system(): return {"system_id":"UNG-MERCURY","domain":"package-intake-sorting","capabilities":["barcode-capture","manual-capture","idempotency","capture-provenance","weight-validation","manual-review-queue","apex-demand-mapping","structured-logging","operator-ui","zipper-live-validation","zipper-destination-resolution"]}
@app.get("/v1/integrations/zipper")
def integration_zipper(): return zipper_health()
@app.get("/v1/destinations/{code}")
def destination(code:str):
    result=resolve_zipper(code)
    if result.get("error","").startswith("zipper_unavailable"): raise HTTPException(503,result)
    if not result.get("valid"): raise HTTPException(404,result)
    return result

def _capture_response(capture):
    payload=serialize_capture(capture)
    return {"capture":payload,"mercury_intake":to_mercury_intake_payload(capture,capture.station_id,capture.operator_id),"apex_demand":to_apex_stop_demand(capture),"duplicate":False}

@app.post("/v1/captures/barcode",status_code=201)
def barcode_capture(body:BarcodeCaptureIn,idempotency_header:str|None=Header(default=None,alias="Idempotency-Key")):
    data=body.model_dump(); data["idempotency_key"]=body.idempotency_key or idempotency_header
    try: capture=capture_from_barcode_scan(**data)
    except ValueError as exc: raise HTTPException(422,str(exc))
    cached=get_idempotent_response(capture.idempotency_key)
    if cached is not None: cached["duplicate"]=True; return cached
    response=_capture_response(capture); stored=store_idempotent_response(capture.idempotency_key,response); stored["duplicate"]=stored.get("capture",{}).get("capture_id")!=capture.capture_id; return stored

@app.post("/v1/captures/manual",status_code=201)
def manual_capture(body:ManualCaptureIn,idempotency_header:str|None=Header(default=None,alias="Idempotency-Key")):
    if (body.destination_type or "").lower() in {"grid","zipper"}:
        resolved=resolve_zipper(body.destination_code or "")
        if resolved.get("error","").startswith("zipper_unavailable"): raise HTTPException(503,resolved)
        if not resolved.get("valid"): raise HTTPException(422,{"error":"invalid_or_unassigned_zipper","zipper":resolved})
    data=body.model_dump(); data["idempotency_key"]=body.idempotency_key or idempotency_header
    try: capture=capture_from_manual_entry(**data)
    except ValueError as exc: raise HTTPException(422,str(exc))
    cached=get_idempotent_response(capture.idempotency_key)
    if cached is not None: cached["duplicate"]=True; return cached
    payload=serialize_capture(capture); review=enqueue_review(payload,"manual_capture_requires_review")
    response={"capture":payload,"manual_review":review,"apex_demand":to_apex_stop_demand(capture),"duplicate":False}
    if (body.destination_type or "").lower() in {"grid","zipper"}: response["zipper"]=resolve_zipper(body.destination_code or "")
    stored=store_idempotent_response(capture.idempotency_key,response); stored["duplicate"]=stored.get("capture",{}).get("capture_id")!=capture.capture_id; return stored

@app.get("/v1/manual-review")
def manual_review(status:str="open",limit:int=Query(100,ge=1,le=500)): return {"results":list_reviews(status=status,limit=limit)}
@app.post("/v1/manual-review/{review_id}/claim")
def review_claim(review_id:str,body:ClaimIn):
    row=claim_review(review_id,body.operator_id)
    if not row: raise HTTPException(404,"review_not_found")
    return row
@app.post("/v1/manual-review/{review_id}/resolve")
def review_resolve(review_id:str,body:ResolveIn):
    row=resolve_review(review_id,body.operator_id,body.resolution)
    if not row: raise HTTPException(404,"review_not_found")
    return row
