# circleci-node-modules-cache-with-npm-ci

## What it flags

Flags CircleCI jobs that restore a `node_modules` cache and later run an unguarded `npm ci` (including `npm clean-install`). Jobs sharing one reusable `commands:` block are reported as a single finding with the job names listed. The install deletes `node_modules`, so the restore was wasted. Save and restore keys are matched by their static prefix, including saves in another job. Commands defined in reusable `commands:` blocks are expanded before checking.

## When it stays silent

- `npm ci` is guarded by a `node_modules` existence check
- the job uses `npm install` instead
- the restore key does not match a `node_modules` save

When a `~/.npm` cache is saved too, the finding is a suggestion: only the `node_modules` entry is redundant.

## Why it matters

CircleCI's dependency caching guidance for npm recommends caching `~/.npm`, not `node_modules`. Restoring `node_modules` only to have `npm ci` remove it wastes cache transfer and restore time.

## Suggested action

Cache `~/.npm` keyed on `package-lock.json` and keep `npm ci`, or keep the `node_modules` cache only with a guarded install.

## Measurement

Compare cache restore time plus install time before and after, and confirm dependency resolution is unchanged.
