# Dedicated ZKTeco ADMS receiver

This module is intentionally separate from `src/attendance` and `src/attendance-device`.
It stores incoming ADMS ATTLOG rows in its own MongoDB collection: `zkteco_attendance_events`.
It does not update existing worktime/attendance documents.

## Files

- `zkteco.module.ts`: module registration
- `zkteco.controller.ts`: ADMS HTTP endpoints under `/iclock`
- `zkteco.service.ts`: ATTLOG parsing and idempotent persistence
- `schemas/zkteco-attendance-event.schema.ts`: dedicated collection schema

## Render environment variables

Set `ZKTECO_DEVICE_SERIAL` to the exact serial number reported by the device in its ADMS request (`SN` query parameter). Do not assume the hardware serial printed on a screen is necessarily the same value; verify it in the request/logs.

`ZKTECO_UTC_OFFSET` defaults to `+01:00` for Algeria. Change it if the terminal is configured to another timezone, e.g. `+00:00`.

## ADMS routes

- `GET /iclock/cdata?SN=...&options=all`
- `POST /iclock/cdata?SN=...&table=ATTLOG`
- `GET /iclock/getrequest?SN=...`
- `GET /iclock/ping?SN=...`

`.aspx` aliases are also registered.

## Important deployment notes

1. Add `ZktecoModule` to the existing `AppModule` (already done in the supplied `app.module.ts` overlay).
2. `main.ts` adds an Express text parser for `text/plain` and `application/octet-stream` while preserving existing CORS and port behavior.
3. Configure the device's ADMS domain as `finalbackendotherversion.onrender.com`, port `443`, and HTTPS enabled only if this firmware's HTTPS implementation is compatible with Render's TLS endpoint.
4. The device must send the serial in `SN` matching `ZKTECO_DEVICE_SERIAL` or the endpoint responds with 403.
5. The ATTLOG parser assumes common tab-separated rows: PIN, timestamp, status, verify mode, work code. Verify a real request before production use.
6. The dedupe key hashes serial + exact raw row. Exact retransmissions are deduplicated. If the device exposes a stable unique record sequence in its ADMS payload, use that after confirming the actual payload.
7. The module acknowledges non-ATTLOG tables without storing them. It does not process events into the existing worktime schema.
8. The ADMS registration response is a standard-style initial response; validate it against the actual Horus TL1 firmware with Render logs before relying on it in production.
