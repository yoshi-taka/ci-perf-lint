import { expect, test } from "bun:test";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import {
  circleCiInvocationsCanCoRun,
  collectCircleCiWorkflowInvocations,
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
