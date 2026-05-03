# avoid-docker-image-via-uses

## What It Detects

Steps using `uses: owner/repo` without `@ref`, `docker://`, or `./` qualifier.

## Why It Matters

If the referenced repo contains a Dockerfile but no action.yml, GitHub Actions builds
the Docker image from the Dockerfile every time the workflow runs. This is much slower
than pulling a pre-built image.

Missing `@ref` also means the action version is unpinned, creating a security and
reproducibility risk.

## Example

```yaml
steps:
  - uses: actions/checkout
  - name: Danger
    uses: danger/danger-js
```

`danger/danger-js` has a Dockerfile but no action.yml. GitHub Actions builds the Docker
image from source every run.

## Suggested Action

- If the repo is a GitHub Action, add `@ref` to pin a version:
  `uses: actions/checkout@v4`
- If the repo is meant as a Docker image, use `docker://` to pull pre-built:
  `uses: docker://ghcr.io/danger/danger-js`

## Measurement

Compare workflow run time before and after switching from bare repo reference to
`docker://` pull or pinned action reference.

## Compatibility

This rule flags only `owner/repo` references without any qualifier. References with
`docker://`, `./`, or `@ref` are ignored.
