from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

ZIPPER_BASE_URL = os.getenv("ZIPPER_BASE_URL", "https://ung-zipper-production.up.railway.app").rstrip("/")


def _get_json(url: str, timeout: float = 8.0):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "UNG-MERCURY/0.3"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            payload = {"detail": str(exc)}
        return exc.code, payload


def zipper_health() -> dict:
    try:
        status, payload = _get_json(f"{ZIPPER_BASE_URL}/ready", timeout=5.0)
        return {"ok": status == 200, "status_code": status, "service": "UNG-ZIPPER", "base_url": ZIPPER_BASE_URL, "details": payload}
    except Exception as exc:
        return {"ok": False, "service": "UNG-ZIPPER", "base_url": ZIPPER_BASE_URL, "error": f"{type(exc).__name__}: {exc}"}


def resolve_zipper(code: str) -> dict:
    normalized = str(code or "").strip()
    if not normalized:
        return {"valid": False, "assigned": False, "code": normalized, "error": "destination_code_required"}
    if normalized.isdigit():
        normalized = normalized.zfill(5)
    quoted = urllib.parse.quote(normalized, safe="")
    try:
        v_status, validation = _get_json(f"{ZIPPER_BASE_URL}/zipper/validate/{quoted}")
        if v_status != 200 or not validation.get("valid"):
            return {"valid": False, "assigned": bool(validation.get("assigned")), "code": normalized, "validation": validation}
        r_status, record = _get_json(f"{ZIPPER_BASE_URL}/zipper/{quoted}")
        if r_status != 200:
            return {"valid": False, "assigned": True, "code": normalized, "error": "zipper_resolution_failed", "details": record}
        return {"valid": True, "assigned": True, "code": normalized, "destination": record, "source": "UNG-ZIPPER"}
    except Exception as exc:
        return {"valid": False, "assigned": False, "code": normalized, "error": f"zipper_unavailable:{type(exc).__name__}"}
