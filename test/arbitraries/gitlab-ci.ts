import fc from "fast-check";

const shortString = fc.string({ maxLength: 20 });
const jobName = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/);

const scriptArb = fc.array(
  fc.string({ maxLength: 50 }),
  { minLength: 1, maxLength: 4 },
);

const jobArb = fc.record({
  stage: fc.option(
    fc.constantFrom("build", "test", "deploy", "lint"),
    { nil: undefined },
  ),
  script: fc.option(scriptArb, { nil: undefined }),
  image: fc.option(
    fc.constantFrom("node:20", "python:3.12", "ubuntu:22.04", "alpine:3.19"),
    { nil: undefined },
  ),
  tags: fc.option(
    fc.array(fc.constantFrom("linux", "docker", "runner"), { maxLength: 3 }),
    { nil: undefined },
  ),
  needs: fc.option(
    fc.array(jobName, { minLength: 0, maxLength: 3 }),
    { nil: undefined },
  ),
  parallel: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  timeout: fc.option(
    fc.constantFrom("10m", "30m", "1h", "2h"),
    { nil: undefined },
  ),
  interruptible: fc.option(fc.boolean(), { nil: undefined }),
  extends: fc.option(
    fc.oneof(shortString, fc.array(shortString, { maxLength: 2 })),
    { nil: undefined },
  ),
  "allow_failure": fc.option(fc.boolean(), { nil: undefined }),
  environment: fc.option(shortString, { nil: undefined }),
  "resource_group": fc.option(shortString, { nil: undefined }),
  cache: fc.option(
    fc.record({
      key: fc.option(shortString, { nil: undefined }),
      paths: fc.option(
        fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
        { nil: undefined },
      ),
      policy: fc.option(
        fc.constantFrom("pull", "push", "pull-push"),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
  artifacts: fc.option(
    fc.record({
      paths: fc.option(
        fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
        { nil: undefined },
      ),
      expire_in: fc.option(
        fc.constantFrom("1d", "1 week", "30 days"),
        { nil: undefined },
      ),
      reports: fc.option(
        fc.record({
          junit: fc.option(
            fc.array(fc.string({ maxLength: 30 }), { maxLength: 2 }),
            { nil: undefined },
          ),
        }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
  rules: fc.option(
    fc.array(
      fc.record({
        if: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
        when: fc.option(
          fc.constantFrom("always", "never", "manual"),
          { nil: undefined },
        ),
      }),
      { maxLength: 3 },
    ),
    { nil: undefined },
  ),
  variables: fc.option(
    fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
    { nil: undefined },
  ),
});

export const gitlabCiObjArb = fc.record({
  stages: fc.option(
    fc.array(fc.constantFrom("build", "test", "deploy", "lint"), { maxLength: 4 }),
    { nil: undefined },
  ),
  variables: fc.option(
    fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
    { nil: undefined },
  ),
  default: fc.option(
    fc.record({
      image: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
      tags: fc.option(
        fc.array(fc.constantFrom("linux", "docker"), { maxLength: 2 }),
        { nil: undefined },
      ),
      timeout: fc.option(
        fc.constantFrom("10m", "30m", "1h"),
        { nil: undefined },
      ),
      interruptible: fc.option(fc.boolean(), { nil: undefined }),
    }),
    { nil: undefined },
  ),
  cache: fc.option(
    fc.record({
      key: fc.option(shortString, { nil: undefined }),
      paths: fc.option(
        fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
  jobs: fc.dictionary(jobName, jobArb, { minKeys: 0, maxKeys: 4 }),
});
