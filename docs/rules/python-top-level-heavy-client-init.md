# python-top-level-heavy-client-init

Detects heavy client, connection, or model initialization at module top level in `src/**/*.py` for FastAPI, Django, and Flask repositories.

Examples:

- `engine = create_engine(...)`
- `s3 = boto3.client("s3")`
- `redis_client = redis.Redis(...)`
- `openai_client = OpenAI(...)`
- `model = AutoModel.from_pretrained(...)`

Why it matters:

- Module-import work increases startup and reload cost.
- It can trigger network, auth, or model-loading work before the app is fully ready.
- It can make process lifecycle and worker behavior less predictable in web apps.

Suggested action:

- Move heavy initialization behind a lazy getter, app startup hook, or dependency injection boundary.
- Keep module top level focused on lightweight definitions and configuration only.

Measurement:

- Compare startup time, import-time cost, and memory usage before and after deferring initialization.

Compatibility notes:

- Lambda-oriented paths and repositories with clear Lambda markers are skipped intentionally.
- `scripts`, `migrations`, and tests are excluded.
