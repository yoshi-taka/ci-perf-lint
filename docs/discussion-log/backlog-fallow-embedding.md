# Backlog: fallow embedding

**Status**: todo
**Date**: 2026-04

## Summary

Embed `fallow` as a repo-hygiene signal layer (dupes, health, circular-deps, boundary-violations) inside this performance lint tool.

## Assessment

- `circular-deps` precision is high but performance lint narrative is weak.
- `dupes` / `health` / `boundary-violations` are mostly off-mission for a GitHub Actions performance auditor.
- Barrel detection + circular-deps could make a stronger `build-risk` finding, but the combo is heavy to build and explain.
- `fallow` itself is very new (v2.51.0 at time of writing). Ecosystem and API stability uncertain.

## Decision

Defer. Revisit only when:

- `fallow` offers a stable library API (not just CLI binary)
- We have a concrete barrel/re-export companion rule
- A perf-impact narrative can be attached to circular-deps (bundler invalidation, tree-shaking, chunk size)
- User demand appears for repo-hygiene signals alongside performance findings
