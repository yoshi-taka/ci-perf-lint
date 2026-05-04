import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import YAML from "yaml";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import { parseGitlabCi } from "../src/gitlab-ci-workflow.ts";

const shortString = fc.string({ maxLength: 20 });
const commandString = fc.string({ maxLength: 60 });
const jobId = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/);

describe("fuzz: parsePipeline", () => {
  test("accepts generated Buildkite-like YAML or throws parse errors only", () => {
    const stepArbitrary = fc.oneof(
      fc.constant("wait"),
      fc.record({
        label: fc.option(shortString, { nil: undefined }),
        command: fc.option(commandString, { nil: undefined }),
        key: fc.option(shortString, { nil: undefined }),
        parallelism: fc.option(fc.integer({ min: 1, max: 256 }), { nil: undefined }),
      }),
    );

    fc.assert(
      fc.property(
        fc.record({ steps: fc.array(stepArbitrary, { maxLength: 20 }) }),
        (pipelineObj) => {
          const yamlString = YAML.stringify(pipelineObj);
          try {
            const doc = parsePipeline("/fuzz/pipeline.yml", "/fuzz", yamlString);
            expect(doc.relativePath).toBe("pipeline.yml");
            expect(Array.isArray(doc.steps)).toBe(true);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
        },
      ),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});

describe("fuzz: parseGitlabCi", () => {
  test("accepts generated GitLab-like YAML or throws parse errors only", () => {
    const jobArbitrary = fc.record({
      stage: fc.option(shortString, { nil: undefined }),
      script: fc.option(fc.array(commandString, { maxLength: 10 }), { nil: undefined }),
      timeout: fc.option(shortString, { nil: undefined }),
      interruptible: fc.option(fc.boolean(), { nil: undefined }),
    });

    fc.assert(
      fc.property(fc.dictionary(jobId, jobArbitrary, { maxKeys: 20 }), (jobs) => {
        const yamlString = YAML.stringify({
          stages: ["test", "build"],
          ...jobs,
        });
        try {
          const doc = parseGitlabCi("/fuzz/.gitlab-ci.yml", "/fuzz", yamlString);
          expect(doc.relativePath).toBe(".gitlab-ci.yml");
          expect(Array.isArray(doc.jobs)).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});

describe("fuzz: parseCircleCi", () => {
  test("accepts generated CircleCI-like YAML or throws parse errors only", () => {
    const stepArbitrary = fc.oneof(
      fc.constant("checkout"),
      fc.record({
        run: fc.option(
          fc.oneof(
            commandString,
            fc.record({
              command: commandString,
              name: fc.option(shortString, { nil: undefined }),
            }),
          ),
          { nil: undefined },
        ),
      }),
    );

    const circleJobArbitrary = fc.record({
      docker: fc.option(fc.array(fc.record({ image: shortString }), { maxLength: 3 }), {
        nil: undefined,
      }),
      parallelism: fc.option(fc.integer({ min: 1, max: 64 }), { nil: undefined }),
      steps: fc.option(fc.array(stepArbitrary, { maxLength: 20 }), { nil: undefined }),
    });

    fc.assert(
      fc.property(
        fc.record({
          version: fc.constant("2.1"),
          jobs: fc.dictionary(jobId, circleJobArbitrary, { maxKeys: 20 }),
        }),
        (config) => {
          const yamlString = YAML.stringify(config);
          try {
            const doc = parseCircleCi("/fuzz/.circleci/config.yml", "/fuzz", yamlString);
            expect(doc.relativePath).toBe(".circleci/config.yml");
            expect(Array.isArray(doc.jobs)).toBe(true);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
        },
      ),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});
