# Development Notes

## Dogfooding

When running `ci-perf-lint` on this repository (`bun run src/cli.ts .`),
findings from `test/fixtures/` may appear. These are expected — the tool correctly
detects issues in intentionally-crafted test data. No action needed.

If you want to exclude fixture noise:

```sh
bun run src/cli.ts . --repository-only --workflow-only
```
