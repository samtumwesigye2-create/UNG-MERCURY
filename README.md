# UNG-MERCURY

UNG-MERCURY is the Uganda National Grid package-intake and sorting capture service.

Initial production-hardening scope:
- barcode/OCR/scale capture contract
- capture IDs and idempotency
- station/device/operator provenance
- tracking/facility/operator validation
- weight sanity bounds
- persistent manual-review queue
- structured logging and audit events
- configurable destination code patterns
- health/readiness endpoints

This repository absorbs the verified package-capture handoff and hardens it for integration with APEX and the wider UNG platform.
