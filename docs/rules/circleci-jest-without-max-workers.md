# circleci-jest-without-max-workers

## What it flags

Flags CircleCI Docker-executor jobs that run Jest without an absolute worker limit. Jest otherwise sizes its worker pool from the host VM's CPU count rather than the container's allocation, which can oversubscribe CPU and memory.

Direct invocations (`jest`, `npx jest`, `yarn jest`, `pnpm jest`, `node_modules/.bin/jest`, `react-scripts test`, `craco test`, `rescripts test`) and invocations resolved through package scripts (`npm test`, `npm run <s>`, `yarn <s>`, `pnpm <s>`) are covered. Effective steps include pre-steps, post-steps, `when` / `unless`, and reusable commands.

## Exclusions

Machine, macOS, Windows, and self-hosted runner jobs are skipped. A visible absolute setting (`--maxWorkers=<n>`, `-w <n>`, `--runInBand`, `-i`, or `maxWorkers: <n>` in Jest config / `package.json`) suppresses the finding. Percentage settings (`50%`) do not count as tuned and are reported at medium confidence.

## Confidence

High for direct Jest invocations with no config-based worker setting. Medium for package-script delegation, dynamic Jest config that cannot be evaluated, or percentage-based settings.

## Suggested action

Add `--maxWorkers=<n>` where `<n>` is the resource class vCPU count, or set `maxWorkers` in the Jest config. Use `--runInBand` only for very small classes such as `small` (1 vCPU).

## Measurement

Compare Jest wall-clock time and peak memory before and after.
