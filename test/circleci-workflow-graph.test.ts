import { expect, test } from "bun:test";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import {
  circleCiInvocationsCanCoRun,
  collectCircleCiWorkflowInvocations,
  type CircleCiInvocationFilters,
  type CircleCiWorkflowInvocation,
} from "../src/circleci-workflow-graph.ts";

function invocations(source: string) {
  const doc = parseCircleCi("/repo/.circleci/config.yml", "/repo", source);
  return collectCircleCiWorkflowInvocations(doc);
}

test("parses the standard job-name form with requires, filters, matrix and parameters", () => {
  const result = invocations(
    [
      "version: 2.1",
      "jobs:",
      "  test: {}",
      "  coverage: {}",
      "workflows:",
      "  ci:",
      "    jobs:",
      "      - test:",
      "      - test-coverage-report:",
      "          name: report-coverage",
      "          requires: [test]",
      "          filters:",
      "            branches:",
      "              only: [main]",
      "      - test:",
      "          name: java-17",
      "          matrix:",
      "            parameters:",
      "              java-version: [17]",
      "          java-version: 17",
    ].join("\n"),
  );

  expect(result).toHaveLength(3);
  expect(result[0]).toMatchObject({ jobName: "test", alias: "test", matrix: false });
  expect(result[1]).toMatchObject({
    jobName: "test-coverage-report",
    alias: "report-coverage",
    requires: ["test"],
  });
  expect(result[1]?.filters.branches?.only).toEqual(["main"]);
  expect(result[2]).toMatchObject({ jobName: "test", alias: "java-17", matrix: true });
  expect(result[2]?.parameters.get("java-version")).toBe("17");
});

test("still parses the explicit job: reference form", () => {
  const result = invocations(
    [
      "version: 2.1",
      "jobs:",
      "  test: {}",
      "workflows:",
      "  ci:",
      "    jobs:",
      "      - job: test",
      "        name: legacy-alias",
    ].join("\n"),
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ jobName: "test", alias: "legacy-alias" });
});

function invocation(filters: CircleCiInvocationFilters): CircleCiWorkflowInvocation {
  return {
    workflowName: "ci",
    jobName: "deploy",
    alias: "deploy",
    requires: [],
    filters,
    matrix: false,
    parameters: new Map(),
    uncertain: false,
    node: undefined,
  };
}

test("17 branch/tag filter combinations match the documented co-run rules", () => {
  const tagOnlyV: CircleCiInvocationFilters = { tags: { only: ["/^v./"] } };
  const noBranchesTagOnlyV: CircleCiInvocationFilters = {
    branches: { ignore: ["/.*/"] },
    tags: { only: ["/^v./"] },
  };
  const noBranchesTagOnlyV1: CircleCiInvocationFilters = {
    branches: { ignore: ["/.*/"] },
    tags: { only: ["/^v1.*/"] },
  };

  const cases: [string, CircleCiInvocationFilters, CircleCiInvocationFilters, boolean][] = [
    [
      "ignore main / only main",
      { branches: { ignore: ["main"] } },
      { branches: { only: ["main"] } },
      false,
    ],
    [
      "ignore [main] / only [main]",
      { branches: { ignore: ["main"] } },
      { branches: { only: ["main"] } },
      false,
    ],
    [
      "only develop / ignore develop",
      { branches: { only: ["develop"] } },
      { branches: { ignore: ["develop"] } },
      false,
    ],
    [
      "ignore all / ignore all",
      { branches: { ignore: ["/.*/"] } },
      { branches: { ignore: ["/.*/"] } },
      false,
    ],
    ["tag only regex twice", noBranchesTagOnlyV, noBranchesTagOnlyV, true],
    ["all branches + tag / tag only", tagOnlyV, noBranchesTagOnlyV1, true],
    ["tag only / no tag filter", noBranchesTagOnlyV, { branches: { ignore: ["/.*/"] } }, false],
    [
      "feature regex / main",
      { branches: { only: ["/feature-.*/"] } },
      { branches: { only: ["main"] } },
      false,
    ],
    [
      "feature regex / feature-foo",
      { branches: { only: ["/feature-.*/"] } },
      { branches: { only: ["feature-foo"] } },
      true,
    ],
    ["main / main", { branches: { only: ["main"] } }, { branches: { only: ["main"] } }, true],
    [
      "main / develop",
      { branches: { only: ["main"] } },
      { branches: { only: ["develop"] } },
      false,
    ],
    [
      "ignore main / only develop",
      { branches: { ignore: ["main"] } },
      { branches: { only: ["develop"] } },
      true,
    ],
    [
      "ignore all / only main",
      { branches: { ignore: ["/.*/"] } },
      { branches: { only: ["main"] } },
      false,
    ],
    [
      "main + tag overlap",
      { branches: { only: ["main"] }, tags: { only: ["/v1.*/"] } },
      { branches: { only: ["main"] }, tags: { only: ["/v1.*/"] } },
      true,
    ],
    [
      "disjoint tags",
      noBranchesTagOnlyV1,
      { branches: { ignore: ["/.*/"] }, tags: { only: ["/v2.*/"] } },
      false,
    ],
    [
      "ignore [main] / only [main] arrays",
      { branches: { ignore: ["main"] } },
      { branches: { only: ["main"] } },
      false,
    ],
    ["no filters", {}, {}, true],
  ];

  for (const [name, a, b, expected] of cases) {
    expect(circleCiInvocationsCanCoRun(invocation(a), invocation(b)), name).toBe(expected);
  }
});

test("scalar, array and regex only filters are compared correctly", () => {
  const [
    scalarDevelop,
    scalarMain,
    arrayDevelop,
    arrayMain,
    regexFeature,
    plainMain,
    featureBranch,
  ] = invocations(
    [
      "version: 2.1",
      "jobs:",
      "  test: {}",
      "workflows:",
      "  ci:",
      "    jobs:",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: develop",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: main",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: [develop]",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: [main]",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: /feature-.*/",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: main",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: feature-foo",
    ].join("\n"),
  );

  expect(scalarDevelop?.filters.branches?.only).toEqual(["develop"]);
  expect(arrayDevelop?.filters.branches?.only).toEqual(["develop"]);
  expect(circleCiInvocationsCanCoRun(scalarDevelop!, scalarMain!)).toBe(false);
  expect(circleCiInvocationsCanCoRun(arrayDevelop!, arrayMain!)).toBe(false);
  expect(circleCiInvocationsCanCoRun(regexFeature!, plainMain!)).toBe(false);
  expect(circleCiInvocationsCanCoRun(regexFeature!, featureBranch!)).toBe(true);
});

test("tag-only jobs co-run on tags but not with jobs lacking a tag filter", () => {
  const [tagOnlyA, tagOnlyB, noTagFilter] = invocations(
    [
      "version: 2.1",
      "jobs:",
      "  deploy: {}",
      "  test: {}",
      "workflows:",
      "  ci:",
      "    jobs:",
      "      - deploy:",
      "          filters:",
      "            branches:",
      "              ignore: /.*/",
      "            tags:",
      "              only: /v.*/",
      "      - deploy:",
      "          filters:",
      "            branches:",
      "              ignore: /.*/",
      "            tags:",
      "              only: /v.*/",
      "      - test:",
      "          filters:",
      "            branches:",
      "              ignore: /.*/",
    ].join("\n"),
  );
  expect(circleCiInvocationsCanCoRun(tagOnlyA!, tagOnlyB!)).toBe(true);
  expect(circleCiInvocationsCanCoRun(tagOnlyA!, noTagFilter!)).toBe(false);
});

test("missing filters overlap and disjoint branches.only sets do not", () => {
  const [plain, mainOnly, developOnly] = invocations(
    [
      "version: 2.1",
      "jobs:",
      "  test: {}",
      "workflows:",
      "  ci:",
      "    jobs:",
      "      - test:",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: [main]",
      "      - test:",
      "          filters:",
      "            branches:",
      "              only: [develop]",
    ].join("\n"),
  );
  expect(circleCiInvocationsCanCoRun(plain!, mainOnly!)).toBe(true);
  expect(circleCiInvocationsCanCoRun(mainOnly!, developOnly!)).toBe(false);
});
