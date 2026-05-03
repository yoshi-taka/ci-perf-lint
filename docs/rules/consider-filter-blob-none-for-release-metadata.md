# consider-filter-blob-none-for-release-metadata

Flags history-aware metadata jobs that may be able to use checkout `filter: blob:none`.

## Why it matters

Some metadata-oriented jobs need deep history for commit ranges, tags, changelogs, or release note generation, but still do not need most repository file contents eagerly downloaded into the checkout.

`fetch-depth` controls how many commits and trees are fetched. Blobs are the file contents attached to those commits. A deeper checkout can therefore become expensive because it may transfer file contents for a large history range even when the job only needs commit metadata.

When a job is mostly reading git metadata, commit metadata, or release metadata, `filter: blob:none` can keep the same history depth while avoiding most file-content transfer. Git can still fetch a blob lazily later if a command actually reads that file.

## Current heuristic

This rule only fires when all of the following are visible:

- the job looks like commitlint, release metadata, tag, changelog, or versioning work
- `actions/checkout` is used
- checkout does not already set `filter: blob:none`
- the job appears history-aware through `fetch-depth: 0` or history-dependent git commands
- the job does not visibly do broad repo scans
- the job does not visibly do heavy build or install work
- the job does not look like the actual release publish/build pipeline that installs code dependencies, compiles, publishes packages, or performs broad branch checkout/pull/merge work
- sparse checkout is already configured, visible path usage is narrow, or the job has a strong metadata-only signal such as `gh release`, GitHub release API calls, release-note/changelog generation, or a known release/changelog action

## Suggested fix

Keep the same history depth if it is needed, and test `filter: blob:none` for jobs that mostly consume commit ranges, tags, history, or release metadata rather than repository file contents.

If the same job later runs an explicit `git fetch --depth ...`, measure whether that fetch should also use `--filter=blob:none`. Do not apply this rule mechanically to release jobs that go on to build, compile, publish, or heavily mutate branches; those jobs often need many blobs anyway.

## Measurement hint

Compare checkout duration, transferred data, lazy blob fetches, and total job time before and after adding `filter: blob:none` with the same fetch depth.
