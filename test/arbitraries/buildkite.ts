import fc from "fast-check";

const shortString = fc.string({ maxLength: 20 });
const labelString = fc.string({ maxLength: 30 });

const pluginArb = fc.record({
  "docker#v5.12.0": fc.option(
    fc.record({
      image: fc.string({ maxLength: 40 }),
      "propagate-environment": fc.option(fc.boolean(), { nil: undefined }),
    }),
    { nil: undefined },
  ),
  "aws-assume-role#v0.1.0": fc.option(
    fc.record({
      role: fc.string({ maxLength: 40 }),
    }),
    { nil: undefined },
  ),
});

const commandStepArb = fc.record({
  label: fc.option(labelString, { nil: undefined }),
  command: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  commands: fc.option(
    fc.array(fc.string({ maxLength: 40 }), { maxLength: 3 }),
    { nil: undefined },
  ),
  key: fc.option(shortString, { nil: undefined }),
  if: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  "timeout_in_minutes": fc.option(fc.integer({ min: 1, max: 120 }), { nil: undefined }),
  agents: fc.option(
    fc.record({
      queue: fc.option(shortString, { nil: undefined }),
      os: fc.option(fc.constantFrom("linux", "windows", "darwin"), { nil: undefined }),
    }),
    { nil: undefined },
  ),
  plugins: fc.option(fc.array(pluginArb, { maxLength: 2 }), { nil: undefined }),
  env: fc.option(
    fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
    { nil: undefined },
  ),
  retry: fc.option(
    fc.record({
      automatic: fc.option(
        fc.array(
          fc.record({
            exit_status: fc.option(fc.constantFrom(-1, 255), { nil: undefined }),
            limit: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
          }),
          { maxLength: 2 },
        ),
        { nil: undefined },
      ),
      manual: fc.option(
        fc.record({
          "allowed": fc.boolean(),
          "permit_on_passed": fc.option(fc.boolean(), { nil: undefined }),
          "reason": fc.option(shortString, { nil: undefined }),
        }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
  "depends_on": fc.option(
    fc.oneof(shortString, fc.array(shortString, { maxLength: 3 })),
    { nil: undefined },
  ),
  "concurrency": fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  "concurrency_group": fc.option(shortString, { nil: undefined }),
});

const waitStepArb = fc.record({
  wait: fc.constant(null),
  continue_on_failure: fc.option(fc.boolean(), { nil: undefined }),
  if: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
});

const blockStepArb = fc.record({
  block: fc.option(labelString, { nil: undefined }),
  if: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  prompt: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
});

const triggerStepArb = fc.record({
  trigger: fc.option(shortString, { nil: undefined }),
  label: fc.option(labelString, { nil: undefined }),
  build: fc.option(
    fc.record({
      message: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
      commit: fc.option(shortString, { nil: undefined }),
      branch: fc.option(shortString, { nil: undefined }),
      env: fc.option(
        fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 2 }),
        { nil: undefined },
      ),
    }),
    { nil: undefined },
  ),
});

const stepArb = fc.oneof(
  commandStepArb,
  waitStepArb,
  blockStepArb,
  triggerStepArb,
);

export const pipelineObjArb = fc.oneof(
  fc.array(stepArb, { minLength: 0, maxLength: 6 }),
  fc.record({
    steps: fc.array(stepArb, { minLength: 0, maxLength: 6 }),
    env: fc.option(
      fc.dictionary(shortString, shortString, { minKeys: 0, maxKeys: 3 }),
      { nil: undefined },
    ),
    agents: fc.option(
      fc.record({
        queue: fc.option(shortString, { nil: undefined }),
      }),
      { nil: undefined },
    ),
  }),
);
