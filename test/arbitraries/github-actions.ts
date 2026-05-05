import fc from "fast-check";

const shortString = fc.string({ maxLength: 20 });
const stepName = fc.string({ maxLength: 30 });
const jobId = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/);

const stepArb = fc.record({
  name: fc.option(stepName, { nil: undefined }),
  uses: fc.option(
    fc.constantFrom(
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "actions/cache@v4",
      "actions/upload-artifact@v4",
      "actions/download-artifact@v4",
      "docker://node:20",
    ),
    { nil: undefined },
  ),
  run: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  if: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  "timeout-minutes": fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined }),
  "working-directory": fc.option(shortString, { nil: undefined }),
  env: fc.option(
    fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
    { nil: undefined },
  ),
});

const matrixArb = fc.record({
  matrix: fc.option(
    fc.record({
      os: fc.option(fc.array(fc.constantFrom("ubuntu-latest", "windows-latest", "macos-latest"), { maxLength: 3 }), { nil: undefined }),
      node: fc.option(fc.array(fc.constantFrom("18", "20", "22"), { maxLength: 3 }), { nil: undefined }),
    }),
    { nil: undefined },
  ),
  "fail-fast": fc.option(fc.boolean(), { nil: undefined }),
  "max-parallel": fc.option(fc.integer({ min: 2, max: 8 }), { nil: undefined }),
});

const strategyArb = fc.record({
  strategy: fc.option(matrixArb, { nil: undefined }),
});

const containerArb = fc.record({
  container: fc.option(
    fc.record({
      image: fc.constantFrom("node:20", "python:3.12", "ubuntu:22.04"),
      env: fc.option(
        fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 2 }),
        { nil: undefined },
      ),
      options: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
    }),
    { nil: undefined },
  ),
});

const servicesArb = fc.record({
  services: fc.option(
    fc.dictionary(
      shortString,
      fc.record({
        image: fc.string({ maxLength: 30 }),
        env: fc.option(
          fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 2 }),
          { nil: undefined },
        ),
        ports: fc.option(
          fc.array(fc.integer({ min: 1024, max: 65535 }), { maxLength: 3 }),
          { nil: undefined },
        ),
      }),
      { minKeys: 0, maxKeys: 2 },
    ),
    { nil: undefined },
  ),
});

const jobArb = fc
  .record({
    "runs-on": fc.option(
      fc.constantFrom("ubuntu-latest", "windows-latest", "macos-latest", "ubuntu-22.04"),
      { nil: undefined },
    ),
    "timeout-minutes": fc.option(fc.integer({ min: 1, max: 360 }), { nil: undefined }),
    steps: fc.option(fc.array(stepArb, { maxLength: 5 }), { nil: undefined }),
    if: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
    uses: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    env: fc.option(
      fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
      { nil: undefined },
    ),
    "continue-on-error": fc.option(fc.boolean(), { nil: undefined }),
  })
  .chain((job) => {
    const withStrategy = strategyArb.map((s) => ({ ...job, ...s }));
    const withContainer = containerArb.map((c) => ({ ...job, ...c }));
    const withServices = servicesArb.map((s) => ({ ...job, ...s }));
    return fc.oneof(
      fc.constant(job),
      withStrategy,
      withContainer,
      withServices,
    );
  });

const triggerArb = fc.oneof(
  fc.constant("push"),
  fc.constant("pull_request"),
  fc.constant("workflow_dispatch"),
  fc.record({ push: fc.option(fc.record({ branches: fc.option(fc.constant(["main", "develop"])) }), { nil: undefined }) }),
  fc.record({ pull_request: fc.option(fc.record({ branches: fc.option(fc.constant(["main"])) }), { nil: undefined }) }),
  fc.record({ schedule: fc.option(fc.array(fc.record({ cron: fc.constant("0 0 * * *") }), { maxLength: 2 }), { nil: undefined }) }),
  fc.record({ workflow_dispatch: fc.option(fc.record({ inputs: fc.option(fc.dictionary(shortString, fc.record({ description: fc.option(shortString, { nil: undefined }), required: fc.option(fc.boolean(), { nil: undefined }) }), { minKeys: 0, maxKeys: 2 })) }), { nil: undefined }) }),
);

const concurrencyArb = fc.record({
  concurrency: fc.option(
    fc.oneof(
      fc.string({ maxLength: 20 }),
      fc.record({ group: fc.string({ maxLength: 20 }), "cancel-in-progress": fc.option(fc.boolean(), { nil: undefined }) }),
    ),
    { nil: undefined },
  ),
});

const defaultsArb = fc.record({
  defaults: fc.option(
    fc.record({
      run: fc.option(
        fc.record({
          "working-directory": fc.option(shortString, { nil: undefined }),
          shell: fc.option(fc.constantFrom("bash", "sh", "pwsh"), { nil: undefined }),
        }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
});

const envArb = fc.record({
  env: fc.option(
    fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
    { nil: undefined },
  ),
});

const permissionsArb = fc.record({
  permissions: fc.option(
    fc.oneof(
      fc.constant("read-all"),
      fc.constant("write-all"),
      fc.record({
        contents: fc.option(fc.constantFrom("read", "write", "none"), { nil: undefined }),
        "pull-requests": fc.option(fc.constantFrom("read", "write", "none"), { nil: undefined }),
        issues: fc.option(fc.constantFrom("read", "write", "none"), { nil: undefined }),
      }),
    ),
    { nil: undefined },
  ),
});

export const workflowObjArb = fc
  .record({
    name: fc.option(stepName, { nil: undefined }),
    on: fc.option(triggerArb, { nil: undefined }),
    jobs: fc.option(
      fc.dictionary(jobId, jobArb, { minKeys: 0, maxKeys: 4 }),
      { nil: undefined },
    ),
  })
  .chain((base) => {
    const extras = fc.oneof(
      concurrencyArb,
      defaultsArb,
      envArb,
      permissionsArb,
      fc.record({}),
    );
    return extras.map((extra) => ({ ...base, ...extra }));
  });
