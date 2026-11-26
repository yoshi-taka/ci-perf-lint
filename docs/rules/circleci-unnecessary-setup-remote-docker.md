# circleci-unnecessary-setup-remote-docker

Detects CircleCI jobs that use `setup_remote_docker` without any visible Docker command.

## Why it matters

`setup_remote_docker` starts a remote Docker environment for the job. It adds setup work and can affect resource allocation. A job that only runs tests, lint, or other non-Docker work pays that cost without using the daemon.

## Detection

Reports when:

- a CircleCI job has a `setup_remote_docker` step
- no other visible step references Docker (`docker`, `docker-compose`, or `depot`)
- the job has no opaque orb step that might invoke Docker

The rule does not prove that a script or opaque orb never uses Docker; it only reports visible evidence.

## Suggested fix

Remove `setup_remote_docker` if the job does not use Docker. If Docker is used indirectly, make the dependency visible or document the referenced script/orb.

## Measurement hint

Compare job setup time and resource usage with and without the `setup_remote_docker` step.
