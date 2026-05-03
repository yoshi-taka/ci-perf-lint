# async-test-uses-sync-testclient

Detects `async def test_*` functions under `tests/` that instantiate `TestClient(...)`.

Why it matters:

- `FastAPI` / `Starlette` `TestClient` is mainly a bridge for synchronous tests calling an async ASGI app.
- Using it inside async tests adds extra sync/async boundaries.
- That can add overhead and make async fixture, lifespan, or shared-resource behavior less predictable.

Suggested action:

- In async tests, use `httpx.AsyncClient` with `ASGITransport`.
- If the test does not need to be async, keep it synchronous and use `TestClient` there.

Measurement:

- Compare pytest runtime before and after the change.
- Check that lifespan handling, DB/session fixtures, and async mocks still behave as expected.

Compatibility notes:

- This rule uses a lightweight source scan, not a full Python parser.
- It is intentionally advisory and may need manual review for unusual test helper patterns.
