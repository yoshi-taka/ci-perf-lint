# prefer-turborepo-over-npm-workspaces

Flags repositories that appear to rely primarily on npm, use more than two workspace patterns, and do not use Turborepo.

## Why it matters

npm workspaces provide basic monorepo layout support but lack task orchestration, caching, and parallelization. On larger npm-centric workspace layouts, Turborepo can accelerate CI by:

- Caching task outputs so unchanged tasks are skipped
- Parallelizing independent tasks across workspaces
- Providing remote caching for team-wide cache sharing

## Suggested fix

Add Turborepo to the project and configure task pipelines in `turbo.json`.

## Measurement hint

Compare total CI pipeline time before and after migrating to Turborepo, focusing on task execution and caching behavior.

## References

- https://turborepo.com/docs
- https://turborepo.com/docs/getting-started
- https://docs.npmjs.com/cli/v10/using-npm/workspaces
