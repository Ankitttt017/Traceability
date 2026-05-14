# Industrial Traceability Flow (Backend Source Of Truth)

## Scan-To-Completion Sequence

1. Scanner sends scan payload to backend TCP server.
2. Backend resolves scanner-to-machine mapping from DB.
3. Backend validates part and station sequence.
4. Backend creates/updates operation log in `PENDING`.
5. Backend acquires machine busy lock (single active cycle per machine).
6. Backend state transitions:
   - `SCANNED` -> `VALIDATED` -> `START_SENT` -> `WAITING_RUNNING`.
7. Backend writes configured `START` value to configured register.
8. Backend holds start signal using configured hold timer.
9. Backend polls configured status register(s) for exact configured running value.
10. On running match, backend state becomes `RUNNING`.
11. Backend continues polling for exact configured end values:
    - `END_OK` value => `COMPLETED_OK`
    - `END_NG` value => `COMPLETED_NG`
12. Backend updates DB only after end match:
    - mark `OK` only on `END_OK`
    - mark `NG` only on `END_NG`
13. Backend sends reset/clear signal(s) and returns machine to safe idle.
14. Backend clears machine lock and sets state `IDLE`.
15. Backend emits realtime events (`machine_state`, `operator_popup`, `dashboard_refresh`).

## Industrial Guarantees

- Frontend never decides pass/fail.
- PLC value checks are exact configured value comparisons.
- PLC operations are serialized per endpoint queue.
- One machine cycle at a time via busy lock + engine busy state.
- Startup recovery marks stale in-flight cycles as recoverable errors.
- Scanner connection uses heartbeat + grace window for stable status.
