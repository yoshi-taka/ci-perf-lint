import fc from "fast-check";

const shortString = fc.string({ maxLength: 20 });
const jobName = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/);

const runStepArb = fc.record({
  run: fc.option(
    fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.record({
        name: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
        command: fc.string({ maxLength: 40 }),
        "working_directory": fc.option(shortString, { nil: undefined }),
        "no_output_timeout": fc.option(
          fc.constantFrom("1m", "5m", "10m"),
          { nil: undefined },
        ),
        shell: fc.option(
          fc.constantFrom("/bin/bash", "/bin/sh"),
          { nil: undefined },
        ),
        background: fc.option(fc.boolean(), { nil: undefined }),
      }),
    ),
    { nil: undefined },
  ),
});

const checkoutStepArb = fc.record({
  checkout: fc.option(
    fc.record({
      path: fc.option(shortString, { nil: undefined }),
    }),
    { nil: undefined },
  ),
});

const cacheStepArb = fc.record({
  "save_cache": fc.option(
    fc.record({
      key: fc.string({ maxLength: 30 }),
      paths: fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
    }),
    { nil: undefined },
  ),
  "restore_cache": fc.option(
    fc.record({
      keys: fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
    }),
    { nil: undefined },
  ),
});

const storeArtifactsArb = fc.record({
  "store_artifacts": fc.option(
    fc.record({
      path: fc.string({ maxLength: 30 }),
      destination: fc.option(shortString, { nil: undefined }),
    }),
    { nil: undefined },
  ),
});

const setupRemoteDockerArb = fc.record({
  "setup_remote_docker": fc.option(
    fc.record({
      version: fc.option(
        fc.constantFrom("20.10.7", "24.0.0"),
        { nil: undefined },
      ),
      "docker_layer_caching": fc.option(fc.boolean(), { nil: undefined }),
    }),
    { nil: undefined },
  ),
});

const stepArb = fc.oneof(
  runStepArb,
  checkoutStepArb,
  cacheStepArb,
  storeArtifactsArb,
  setupRemoteDockerArb,
);

const jobArb = fc.record({
  docker: fc.option(
    fc.array(
      fc.record({
        image: fc.constantFrom("node:20", "python:3.12", "circleci/node:5", "cimg/base:2024.01"),
        auth: fc.option(
          fc.record({
            username: fc.option(shortString, { nil: undefined }),
            password: fc.option(shortString, { nil: undefined }),
          }),
          { nil: undefined },
        ),
      }),
      { minLength: 1, maxLength: 2 },
    ),
    { nil: undefined },
  ),
  "resource_class": fc.option(
    fc.constantFrom("small", "medium", "large", "xlarge", "2xlarge"),
    { nil: undefined },
  ),
  parallelism: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  environment: fc.option(
    fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
    { nil: undefined },
  ),
  steps: fc.option(fc.array(stepArb, { minLength: 0, maxLength: 5 }), { nil: undefined }),
});

export const circleCiObjArb = fc.record({
  version: fc.option(
    fc.constantFrom(2.0, 2.1),
    { nil: undefined },
  ),
  orbs: fc.option(
    fc.dictionary(shortString, fc.string({ maxLength: 30 }), { minKeys: 0, maxKeys: 2 }),
    { nil: undefined },
  ),
  parameters: fc.option(
    fc.dictionary(
      shortString,
      fc.record({
        type: fc.constantFrom("string", "boolean", "integer", "enum"),
      }),
      { minKeys: 0, maxKeys: 2 },
    ),
    { nil: undefined },
  ),
  jobs: fc.dictionary(jobName, jobArb, { minKeys: 0, maxKeys: 4 }),
});
