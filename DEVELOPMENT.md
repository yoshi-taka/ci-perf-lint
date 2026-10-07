# Development Notes

## Dogfooding

When running `ci-perf-lint` on this repository (`bun run src/cli.ts .`),
findings from `test/fixtures/` may appear. These are expected — the tool correctly
detects issues in intentionally-crafted test data. No action needed.

If you want to exclude fixture noise:

```sh
bun run src/cli.ts . --workflow-only
```

This audits the repository's CI definitions without repository-wide fixture source scans.
`--workflow-only` and `--repository-only` are mutually exclusive.
