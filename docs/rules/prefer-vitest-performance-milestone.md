# prefer-vitest-performance-milestone

Suggests moving a Vitest project to the next notable speed milestone, one step at a time.

## What it detects

- `vitest` declared in `package.json` below the next performance milestone:
  - below 3 → 3
  - 3.x → 4
  - 4.x → 5

Projects already on 5.x are not flagged.

The root lockfile dependency takes precedence over a manifest lower bound. Aliases to other packages (including Vite Plus Test) are not interpreted as Vitest versions.

## Version performance notes

Only the releases that materially moved performance are listed.

| Version | Performance highlight |
|---|---|
| 3.0 | Browser `instances` run multiple browser setups against a single Vite server, so shared files are transformed once. 3.0.0 also introduced a regression fixed in 3.0.1, so target 3.0.1+. |
| 3.2 | v8 coverage gained AST-aware remapping via `ast-v8-to-istanbul` (opt-in through `coverage.experimentalAstAwareRemapping`), bringing v8 in line with istanbul at better performance. |
| 4.0 | Broad internal perf pass: avoid spawning workers that get no tests, delay populating node globals, one fetcher per project, resolve environments up front, switch to `meta.resolve`. Browser Mode becomes stable. |
| 4.1 | Experimental `viteModuleRunner: false` runs tests with native `import`, skipping transforms for faster startup. Adds Vite 8 support. |
| 5.0 | Performance-focused major: vmThreads dependency-heavy about -53%, vmForks happy-dom about -25%, a 1,280-module monolith about -19%. Shared Vite server, stable `fsModuleCache`, one-round-trip warm modules, vm compiled-code reuse with module-graph prewarming, adaptive Browser Mode startup, and bundled dependencies. |

## Milestones

### Vitest 3

Vitest 3 adds browser `instances`, which run multiple browser setups against a single Vite server so shared files are transformed once instead of per workspace entry. Vitest 3.0.0 also introduced a performance regression that was fixed in 3.0.1, so target 3.0.1 or later.

### Vitest 4

Vitest 4 makes a broad set of internal performance changes: it avoids spawning workers that get no tests, stops setting `process.title`, drops chai as a direct dependency, reduces dynamic imports, delays populating node globals, uses one fetcher per project, resolves environments up front, and switches to `meta.resolve`. Browser Mode also becomes stable.

### Vitest 5

Vitest 5 makes performance its main focus (see the version notes above for the benchmark highlights): it shares the Vite server across inline projects, stabilizes the on-disk `fsModuleCache`, serves warm modules to workers in a single round trip, reuses compiled code across vm pool contexts with module-graph prewarming, prewarms Browser Mode, and bundles its own dependencies. Vitest 4.1 already added the experimental `viteModuleRunner: false` opt-in for faster native-import runs.

Vitest 5 is a **breaking major** and requires **Vite >= 6.4** and **Node.js >= 22.12**.

## Suggested action

Move one milestone at a time. Each step is a major, so review that major's migration guide, run the suite, and confirm behavior and coverage are unchanged. Most mechanical changes are codemod-friendly, so an AI-assisted migration is usually practical.

## Measurement

Compare full `vitest run` wall-clock time and peak memory before and after each step, especially for vm pools, Browser Mode, and large isolated suites.
