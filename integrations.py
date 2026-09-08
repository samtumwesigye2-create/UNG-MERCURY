from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

ZIPPER_BASE_URL = os.getenv("ZIPPER_BASE_URL", "https://ung-zipper-production.up.railway.app").rstrip("/")
VECTOR_BASE_URL = os.getenv("VECTOR_BASE_URL", "https://ung-vector-production.up.railway.app").rstrip("/")
VECTOR_SERVICE_TOKEN = os.getenv("MERCURY_VECTOR_SERVICE_TOKEN", "").strip()


def _json_request(url: str, *, method: str = "GET", payload: dict | None = None, token: str = "", timeout: float = 8.0):
    headers={"Accept":"application/json","User-Agent":"UNG-MERCURY/0.4"}
    data=None
    if payload is not None:
        data=json.dumps(payload,separators=(",",":")).encode("utf-8"); headers["Content-Type"]="application/json"
    if token: headers["Authorization"]="Bearer "+token
    req=urllib.request.Request(url,data=data,method=method,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as response:
            raw=response.read().decode("utf-8"); return response.status,json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        try: body=json.loads(exc.read().decode("utf-8"))
        except Exception: body={"detail":str(exc)}
        return exc.code,body


def _get_json(url: str, timeout: float = 8.0): return _json_request(url,timeout=timeout)


def zipper_health() -> dict:
    try:
        status,payload=_get_json(f"{ZIPPER_BASE_URL}/ready",timeout=5.0)
        return {"ok":status==200,"status_code":status,"service":"UNG-ZIPPER","base_url":ZIPPER_BASE_URL,"details":payload}
    except Exception as exc: return {"ok":False,"service":"UNG-ZIPPER","base_url":ZIPPER_BASE_URL,"error":f"{type(exc).__name__}: {exc}"}


def resolve_zipper(code: str) -> dict:
    normalized=str(code or "").strip()
    if not normalized:return {"valid":False,"assigned":False,"code":normalized,"error":"destination_code_required"}
    if normalized.isdigit(): normalized=normalized.zfill(5)
    quoted=urllib.parse.quote(normalized,safe="")
    try:
        v_status,validation=_get_json(f"{ZIPPER_BASE_URL}/zipper/validate/{quoted}")
        if v_status!=200 or not validation.get("valid"):return {"valid":False,"assigned":bool(validation.get("assigned")),"code":normalized,"validation":validation}
        r_status,record=_get_json(f"{ZIPPER_BASE_URL}/zipper/{quoted}")
        if r_status!=200:return {"valid":False,"assigned":True,"code":normalized,"error":"zipper_resolution_failed","details":record}
        return {"valid":True,"assigned":True,"code":normalized,"destination":record,"source":"UNG-ZIPPER"}
    except Exception as exc:return {"valid":False,"assigned":False,"code":normalized,"error":f"zipper_unavailable:{type(exc).__name__}"}


def vector_health() -> dict:
    try:
        status,payload=_get_json(f"{VECTOR_BASE_URL}/ready",timeout=5.0)
        return {"ok":status==200 and payload.get("status")=="ready","status_code":status,"service":"UNG-VECTOR","base_url":VECTOR_BASE_URL,"authenticated":bool(VECTOR_SERVICE_TOKEN),"details":payload}
    except Exception as exc:return {"ok":False,"service":"UNG-VECTOR","base_url":VECTOR_BASE_URL,"authenticated":bool(VECTOR_SERVICE_TOKEN),"error":f"{type(exc).__name__}: {exc}"}


def handoff_to_vector(capture: dict, *, destination: dict | None = None) -> dict:
    if not VECTOR_SERVICE_TOKEN:return {"ok":False,"error":"vector_service_token_not_configured","service":"UNG-VECTOR"}
    message_id="mercury:"+str(capture.get("capture_id") or capture.get("idempotency_key") or "unknown")
    envelope={"message_id":message_id,"source_system":"UNG-MERCURY","target_system":"UNG-VECTOR","message_type":"MERCURY.PACKAGE.CAPTURED","payload":{"capture":capture,"destination":destination or {}}}
    try:
        status,payload=_json_request(f"{VECTOR_BASE_URL}/v1/nexus/inbound",method="POST",payload=envelope,token=VECTOR_SERVICE_TOKEN,timeout=8.0)
        return {"ok":status in (200,202),"status_code":status,"service":"UNG-VECTOR","message_id":message_id,"response":payload}
    except Exception as exc:return {"ok":False,"service":"UNG-VECTOR","message_id":message_id,"error":f"vector_unavailable:{type(exc).__name__}"}
