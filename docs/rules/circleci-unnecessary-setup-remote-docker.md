# circleci-unnecessary-setup-remote-docker

Detects CircleCI jobs that use `setup_remote_docker` without any visible Docker command.

## Why it matters

`setup_remote_docker` starts a remote Docker environment for the job. It adds setup work and can affect resource allocation. A job that only runs tests, lint, or other non-Docker work pays that cost without using the daemon.

## Detection

Reports when:

- a CircleCI job has a `setup_remote_docker` step
- no other visible step references Docker (`docker`, `docker-compose`, or `depot`)
- no indirect command can hide Docker: `make <target>`, repository shell scripts, package scripts (`npm run`, `yarn`, `pnpm`), or task runners (`just`, `task`, `rake`, `invoke`, `nox`, `tox`)

Referenced Makefiles, scripts, and package scripts are traced with the shared helpers; Docker in the traced text suppresses the finding. An untraceable reference (missing file, workflow-only mode, dynamic target, or opaque orb) also suppresses it. The rule only reports when indirect work is traceable and contains no Docker command.

## Suggested fix

Remove `setup_remote_docker` if the job does not use Docker. If Docker is used indirectly, make the dependency visible or document the referenced script/orb.

## Measurement hint

Compare job setup time and resource usage with and without the `setup_remote_docker` step.
