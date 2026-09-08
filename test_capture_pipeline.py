from capture_pipeline import capture_from_barcode_scan, capture_from_manual_entry, to_apex_stop_demand
import idempotency_store


def test_capture_provenance_and_idempotency():
    c = capture_from_barcode_scan(
        "TRK123456",
        weight_kg=12.5,
        station_id="FAC01",
        device_id="SCANNER-01",
        operator_id="op1",
        idempotency_key="fixed-key",
    )
    assert c.capture_id
    assert c.idempotency_key == "fixed-key"
    assert c.station_id == "FAC01"
    assert c.device_id == "SCANNER-01"
    assert c.operator_id == "op1"
    assert c.captured_at.endswith("+00:00")


def test_invalid_weight_rejected():
    try:
        capture_from_barcode_scan("TRK123", weight_kg=-1, station_id="FAC01", device_id="D1", operator_id="op1")
        assert False, "expected rejection"
    except ValueError as exc:
        assert "weight_out_of_bounds" in str(exc)


def test_bad_tracking_rejected():
    try:
        capture_from_barcode_scan("!!", station_id="FAC01", device_id="D1", operator_id="op1")
        assert False, "expected rejection"
    except ValueError as exc:
        assert "invalid_tracking_number" in str(exc)


def test_manual_capture_is_reviewable():
    c = capture_from_manual_entry(tracking_number="TRK-MAN-1", station_id="FAC01", device_id="D1", operator_id="op1")
    assert c.needs_manual_review is True
    assert to_apex_stop_demand(c) == 1.0


def test_idempotency_store_returns_first_response_on_replay(tmp_path, monkeypatch):
    monkeypatch.setattr(idempotency_store, "DB_PATH", str(tmp_path / "idempotency.db"))
    idempotency_store.init_idempotency_store()

    first = {"capture": {"capture_id": "CAP-1"}, "duplicate": False}
    replay = {"capture": {"capture_id": "CAP-2"}, "duplicate": False}

    assert idempotency_store.store_idempotent_response("same-key", first)["capture"]["capture_id"] == "CAP-1"
    assert idempotency_store.store_idempotent_response("same-key", replay)["capture"]["capture_id"] == "CAP-1"
    assert idempotency_store.get_idempotent_response("same-key")["capture"]["capture_id"] == "CAP-1"
