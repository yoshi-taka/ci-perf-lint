# buildkite-docker-compose-run-without-prebuild

Reported as a warning with medium confidence. Applies to Buildkite pipeline files, including steps inside group steps.

The [docker-compose Buildkite plugin](https://github.com/buildkite-plugins/docker-compose-buildkite-plugin) recommends a single prebuild step when several steps use the same service: `build: <service>` plus `push: <service>`, then `run: <service>` in the later steps. Without that step every `run` step builds the service image on its own agent.

## What it detects

One finding per pipeline file and service when all of these hold:

1. Steps using the `docker-compose` plugin (any version) execute `run: <service>` two or more times in that pipeline file. `parallelism: N` counts as N executions, and a `matrix` counts as its number of combinations.
2. No step in the same pipeline file uses the plugin with both `build` containing that service and `push` containing that service (`svc` or `svc:registry:tag`). A step that only builds without pushing is not a prebuild.
3. No `run` step for that service sets `run-image`, which supplies the image from elsewhere.
4. A compose file is available and the service has a `build:` key. The file is resolved from the plugin's `config` option, then `COMPOSE_FILE` in the step or pipeline `env`, then `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, or `compose.yaml` at the repository root.

A service that only has `image:` is not reported, and neither is a pipeline whose compose file cannot be read. Location is the first `run` step for the service.

## Why it matters

Buildkite agents get a fresh checkout and do not share a Docker layer cache. Each `run` step that has to build the service repeats the whole build on a different agent, multiplying build time and registry/network traffic by the number of executions. Pushing once lets the plugin's build metadata hand the published image to every later step.

Medium confidence: an agent pool that intentionally keeps the Docker daemon layer cache between jobs can make a local rebuild fast, and a pipeline file cannot show that.

## Suggested action

Add one step with `build: <svc>` and `push: <svc>:<registry>/<repo>:<tag>`, together with the registry login plugin already used in the pipeline. Put `wait` or `depends_on` before the run steps and keep `run: <svc>` in those steps; the plugin reads the pushed image from build metadata.

## Measurement or verification guidance

Compare the docker-compose build time inside each run step and total build time before and after adding the prebuild step.

## Compatibility notes

- Only Buildkite pipeline files are audited; dynamic pipeline uploads are not expanded.
- Compose files with unparsable YAML provide no evidence and suppress the finding.
- Compose file resolution is bounded to eight candidates per service; nested compose includes and `extends` are not followed.
