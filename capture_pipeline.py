from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from hashlib import sha256
import os
import re
from typing import Optional
from uuid import uuid4

GRID_CODE_PATTERN = re.compile(os.getenv("MERCURY_GRID_CODE_REGEX", r"UG-[A-Z]{3}-\d{6}"))
TRACKING_PATTERN = re.compile(os.getenv("MERCURY_TRACKING_REGEX", r"^[A-Z0-9][A-Z0-9-]{2,63}$"), re.IGNORECASE)
FACILITY_PATTERN = re.compile(os.getenv("MERCURY_FACILITY_REGEX", r"^[A-Z0-9][A-Z0-9_-]{1,31}$"), re.IGNORECASE)
OPERATOR_PATTERN = re.compile(os.getenv("MERCURY_OPERATOR_REGEX", r"^[A-Z0-9][A-Z0-9_.@-]{1,63}$"), re.IGNORECASE)
MIN_WEIGHT_KG = float(os.getenv("MERCURY_MIN_WEIGHT_KG", "0"))
MAX_WEIGHT_KG = float(os.getenv("MERCURY_MAX_WEIGHT_KG", "5000"))

@dataclass(frozen=True)
class PackageCapture:
    capture_id: str
    tracking_number: Optional[str]
    destination_code: Optional[str]
    destination_type: Optional[str]
    weight_kg: Optional[float]
    capture_method: str
    needs_manual_review: bool
    captured_at: str
    station_id: str
    device_id: str
    operator_id: str
    idempotency_key: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_tracking(v: str) -> str:
    value = (v or "").strip()
    if not TRACKING_PATTERN.fullmatch(value):
        raise ValueError("invalid_tracking_number")
    return value


def _validate_facility(v: str) -> str:
    value = (v or "").strip()
    if not FACILITY_PATTERN.fullmatch(value):
        raise ValueError("invalid_facility_code")
    return value


def _validate_operator(v: str) -> str:
    value = (v or "").strip()
    if not OPERATOR_PATTERN.fullmatch(value):
        raise ValueError("invalid_operator_id")
    return value


def validate_weight_kg(weight_kg: Optional[float]) -> Optional[float]:
    if weight_kg is None:
        return None
    value = float(weight_kg)
    if value < MIN_WEIGHT_KG or value > MAX_WEIGHT_KG:
        raise ValueError("weight_out_of_bounds")
    return value


def build_idempotency_key(*, tracking_number: Optional[str], station_id: str, device_id: str, captured_at_bucket: Optional[str] = None) -> str:
    bucket = captured_at_bucket or datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    raw = f"{tracking_number or '-'}|{station_id}|{device_id}|{bucket}".encode()
    return sha256(raw).hexdigest()


def capture_from_barcode_scan(tracking_number: str, *, weight_kg: Optional[float] = None, station_id: str, device_id: str, operator_id: str, idempotency_key: Optional[str] = None) -> PackageCapture:
    tracking = _validate_tracking(tracking_number)
    station = _validate_facility(station_id)
    operator = _validate_operator(operator_id)
    weight = validate_weight_kg(weight_kg)
    key = idempotency_key or build_idempotency_key(tracking_number=tracking, station_id=station, device_id=device_id)
    return PackageCapture(
        capture_id=str(uuid4()), tracking_number=tracking, destination_code=None, destination_type=None,
        weight_kg=weight, capture_method="barcode", needs_manual_review=False, captured_at=_now(),
        station_id=station, device_id=device_id.strip(), operator_id=operator, idempotency_key=key,
    )


def capture_from_manual_entry(*, tracking_number: Optional[str] = None, destination_code: Optional[str] = None, destination_type: Optional[str] = None, weight_kg: Optional[float] = None, station_id: str, device_id: str, operator_id: str, idempotency_key: Optional[str] = None) -> PackageCapture:
    if not tracking_number and not destination_code:
        raise ValueError("manual_capture_requires_tracking_or_destination")
    tracking = _validate_tracking(tracking_number) if tracking_number else None
    station = _validate_facility(station_id)
    operator = _validate_operator(operator_id)
    weight = validate_weight_kg(weight_kg)
    key = idempotency_key or build_idempotency_key(tracking_number=tracking or destination_code, station_id=station, device_id=device_id)
    return PackageCapture(
        capture_id=str(uuid4()), tracking_number=tracking, destination_code=destination_code,
        destination_type=destination_type, weight_kg=weight, capture_method="manual",
        needs_manual_review=True, captured_at=_now(), station_id=station, device_id=device_id.strip(),
        operator_id=operator, idempotency_key=key,
    )


def to_mercury_intake_payload(capture: PackageCapture, facility_code: str, scanned_by: str) -> dict:
    if not capture.tracking_number:
        raise ValueError("tracking_number_required_for_intake")
    _validate_facility(facility_code)
    _validate_operator(scanned_by)
    return {
        "capture_id": capture.capture_id,
        "idempotency_key": capture.idempotency_key,
        "captured_at": capture.captured_at,
        "tracking_number": capture.tracking_number,
        "facility_code": facility_code,
        "scanned_by": scanned_by,
        "station_id": capture.station_id,
        "device_id": capture.device_id,
        "device_hint": capture.capture_method,
        "weight_kg": capture.weight_kg,
    }


def to_apex_stop_demand(capture: PackageCapture, default_demand: float = 1.0) -> float:
    return capture.weight_kg if capture.weight_kg is not None else float(default_demand)


def serialize_capture(capture: PackageCapture) -> dict:
    return asdict(capture)
