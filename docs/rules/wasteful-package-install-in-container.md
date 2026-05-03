# wasteful-package-install-in-container

## What It Detects

Jobs that run inside a Docker container (`container:`) but install OS packages
(`apt-get install`, `apk add`, `brew install`, etc.) in workflow steps where the
installed packages are not referenced in later steps.

## Why It Matters

If the job already runs in a container, dependencies should be baked into the
Docker image. Installing packages in CI steps:

- Adds unnecessary runtime overhead (30-60s per job)
- Breaks reproducibility of the container image
- Suggests the Dockerfile is incomplete

## Example

```yaml
jobs:
  test:
    container: node:20
    steps:
      - uses: actions/checkout@v4
      - run: apt-get install -y jq
      - run: npm test
```

`jq` is installed but never used in later steps. It should either be added to
the Docker image or removed from the install step.

## Suggested Action

Add the unused packages to the Docker image's Dockerfile instead of installing
at runtime in CI steps.

## Measurement

Compare job wall-clock time before and after moving package installs from CI
steps into the Docker image.

## Compatibility

This rule fires only for jobs with a `container:` field. It checks whether the
installed package name appears in any later step's `name`, `run`, or `uses`
text. If the package name is referenced but the binary is used indirectly (e.g.
via a wrapper script), the rule may not fire.
