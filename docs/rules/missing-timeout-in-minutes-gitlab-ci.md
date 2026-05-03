# missing-timeout-in-minutes-gitlab-ci

GitLab CI jobs use a project-level default timeout (60 minutes). Heavy jobs should use an explicit `timeout` to prevent runaway builds and wasted CI minutes.

## Why this matters

- **Default timeout is long**: The project-level default is 60 minutes, which is excessive for most jobs
- **Resource waste**: Hung jobs consume runner capacity and CI minutes
- **Pipeline blocking**: Long-running jobs can block subsequent stages and delay feedback

## What to look for

Jobs that run heavy operations without a timeout:

```yaml
build-app:
  stage: build
  script:
    - npm ci
    - npm run build
  # Missing: timeout
```

## Recommended fix

Add `timeout` to jobs that run heavy operations:

```yaml
build-app:
  stage: build
  script:
    - npm ci
    - npm run build
  timeout: 30m
```

## Scope

This rule only applies to GitLab CI configuration files (`.gitlab-ci.yml`).
