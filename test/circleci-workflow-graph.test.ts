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

test("parses job references, aliases, requires, filters, matrix and parameters", () => {
  const result = invocations(
    [
      "version: 2.1",
      "jobs:",
      "  test: {}",
      "  coverage: {}",
      "workflows:",
      "  ci:",
      "    jobs:",
      "      - test",
      "      - job: coverage",
      "        name: test-coverage-report",
      "        requires: [test]",
      "        filters:",
      "          branches:",
      "            only: [main]",
      "      - job: test",
      "        name: java-VERSION",
      "        matrix:",
      "          parameters:",
      "            VERSION: [17, 21]",
      "        java-version: 17",
    ].join("\n"),
  );

  expect(result).toHaveLength(3);
  expect(result[0]).toMatchObject({ jobName: "test", alias: "test", matrix: false });
  expect(result[1]).toMatchObject({
    jobName: "coverage",
    alias: "test-coverage-report",
    requires: ["test"],
  });
  expect(result[1]?.filters.branches?.only).toEqual(["main"]);
  expect(result[2]).toMatchObject({ jobName: "test", alias: "java-VERSION", matrix: true });
  expect(result[2]?.parameters.get("java-version")).toBe("17");
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
      "      - test",
      "      - job: test",
      "        filters:",
      "          branches:",
      "            only: [main]",
      "      - job: test",
      "        filters:",
      "          branches:",
      "            only: [develop]",
    ].join("\n"),
  );
  expect(circleCiInvocationsCanCoRun(plain!, mainOnly!)).toBe(true);
  expect(circleCiInvocationsCanCoRun(mainOnly!, developOnly!)).toBe(false);
});
