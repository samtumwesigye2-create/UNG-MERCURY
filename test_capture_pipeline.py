from capture_pipeline import capture_from_barcode_scan, capture_from_manual_entry, to_apex_stop_demand


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
