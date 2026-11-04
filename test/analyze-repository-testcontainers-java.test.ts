import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, assertRuleTestReport, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const sleepRule = { id: "testcontainers-fixed-sleep-after-start", severity: "warning" } as const;
const lifecycleRule = {
  id: "consider-testcontainers-shared-lifecycle",
  severity: "suggestion",
} as const;

function source(
  body: string,
  field = '@Container private static final GenericContainer<?> database = new GenericContainer<>("postgres:16");',
  extra = "",
): string {
  return `import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.junit.jupiter.api.Test;
@Testcontainers
class DatabaseTest {
  ${field}
  ${extra}
  @Test void first() throws Exception {
    ${body}
  }
  @Test void second() {}
}
`;
}
const sleepCases: Record<string, string> = {
  adjacent: source("database.start();\n    Thread.sleep(5_000L);"),
  sameLine: source("database.start(); Thread.sleep(1);"),
  receiver: source("this.database.start(); Thread.sleep(1000);"),
  commentsBetween: source("database.start(); /* warmup */\n    // wait\n    Thread.sleep(5000);"),
  local: source(
    'GenericContainer<?> redis = new GenericContainer<>("redis:7"); redis.start(); Thread.sleep(1000);',
    "",
  ),
};
const negativeSleep: Record<string, string> = {
  ready: source("database.start();"),
  dynamic: source("database.start(); Thread.sleep(delay);"),
  zero: source("database.start(); Thread.sleep(0);"),
  negative: source("database.start(); Thread.sleep(-1);"),
  statementBetween: source("database.start(); verifyReady(); Thread.sleep(5000);"),
  unrelated: source("other.start(); Thread.sleep(5000);"),
  otherOwner: source("other.database.start(); Thread.sleep(5000);"),
  reassigned: source("database = getContainer(); database.start(); Thread.sleep(5000);"),
  parameterShadow: source(
    "",
    undefined,
    "void setup(GenericContainer<?> database) throws Exception { database.start(); Thread.sleep(5000); }",
  ),
  comment: source("// database.start(); Thread.sleep(5000);"),
  blockComment: source("/* database.start(); Thread.sleep(5000); */"),
  quoted: source('String example = "database.start(); Thread.sleep(5000);";'),
  textBlock: source('String example = """\n database.start(); Thread.sleep(5000);\n """;'),
  unrelatedType: source(
    "database.start(); Thread.sleep(5000);",
    "private static final OtherContainer database = new OtherContainer();",
  ),
  shadowedThread: source("database.start(); Thread.sleep(5000);", undefined, "class Thread {}"),
  shadowedThreadField: source(
    "database.start(); Thread.sleep(5000);",
    undefined,
    "private Sleeper Thread;",
  ),
  wildcard: source("database.start(); Thread.sleep(5000);").replace(
    "import org.testcontainers.containers.GenericContainer;",
    "import org.testcontainers.containers.*;",
  ),
};
const instanceField =
  '@Container private final GenericContainer<?> database = new GenericContainer<>("postgres:16");';
const lifecycleCases: Record<string, string> = {
  instance: source("", instanceField),
  typedModule: source(
    "",
    instanceField.replaceAll("GenericContainer", "PostgreSQLContainer"),
  ).replace(
    "import org.testcontainers.containers.GenericContainer;",
    "import org.testcontainers.containers.PostgreSQLContainer;",
  ),
};
const negativeLifecycle: Record<string, string> = {
  shared: source(""),
  singleTest: source("", instanceField).replace("@Test void second() {}", ""),
  noAnnotation: source("", instanceField.replace("@Container ", "")),
  noExtension: source("", instanceField).replace("@Testcontainers\n", ""),
  noImports: source("", instanceField).replace(
    "import org.testcontainers.junit.jupiter.Container;",
    "",
  ),
  reuse: source("", instanceField.replace(");", ").withReuse(true);")),
  nested: source("", instanceField, "class NestedTests { @Test void nested() {} }"),
  parallel: source("", instanceField).replace(
    "@Testcontainers\n",
    "@Testcontainers\n@Execution(CONCURRENT)\n",
  ),
};

describe("Testcontainers Java startup and lifecycle evidence", () => {
  let report: Awaited<ReturnType<typeof analyzeRepositoryForRule>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-testcontainers-java-");
    const dir = path.join(root, "src/test/java");
    await mkdir(dir, { recursive: true });
    await mkdir(path.join(root, ".github/workflows"), { recursive: true });
    await writeFile(
      path.join(root, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion><groupId>test</groupId><artifactId>test</artifactId><version>1</version></project>",
    );
    await writeFile(
      path.join(root, ".github/workflows/ci.yml"),
      "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: mvn test\n",
    );
    const files = {
      ...Object.fromEntries(
        Object.entries(sleepCases).map(([name, text]) => [`sleep-${name}`, text]),
      ),
      ...Object.fromEntries(
        Object.entries(negativeSleep).map(([name, text]) => [`no-sleep-${name}`, text]),
      ),
      ...Object.fromEntries(
        Object.entries(lifecycleCases).map(([name, text]) => [`lifecycle-${name}`, text]),
      ),
      ...Object.fromEntries(
        Object.entries(negativeLifecycle).map(([name, text]) => [`no-lifecycle-${name}`, text]),
      ),
    };
    await Promise.all(
      Object.entries(files).map(([name, text]) => writeFile(path.join(dir, `${name}.java`), text)),
    );
    await mkdir(path.join(root, "module/src/integrationTest/java"), { recursive: true });
    await writeFile(
      path.join(root, "module/src/integrationTest/java/IntegrationTest.java"),
      sleepCases.adjacent!,
    );
    await mkdir(path.join(root, "src/main/java"), { recursive: true });
    await writeFile(path.join(root, "src/main/java/NotTest.java"), sleepCases.adjacent!);
    report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "exploratory", topCount: 500 },
      sleepRule,
    );
    assertRuleTestReport(report, lifecycleRule, "exploratory");
  });
  function findings(name: string, id: string) {
    return report.findings.filter(
      (finding) => finding.ruleId === id && finding.location.path === `src/test/java/${name}.java`,
    );
  }
  for (const name of Object.keys(sleepCases)) {
    test(`fixed sleep: ${name}`, () => {
      const matches = findings(`sleep-${name}`, sleepRule.id);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.severity).toBe("warning");
      expect(matches[0]?.suggestion).toContain("elapsed time");
      const text = sleepCases[name]!;
      expect(matches[0]?.location.line).toBe(
        text.slice(0, text.indexOf("Thread.sleep")).split("\n").length,
      );
    });
  }
  for (const name of Object.keys(negativeSleep)) {
    test(`no sleep inference: ${name}`, () => {
      expect(findings(`no-sleep-${name}`, sleepRule.id)).toHaveLength(0);
    });
  }
  for (const name of Object.keys(lifecycleCases)) {
    test(`per-test lifecycle: ${name}`, () => {
      const matches = findings(`lifecycle-${name}`, lifecycleRule.id);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.severity).toBe("suggestion");
      expect(matches[0]?.suggestion).toContain("explicit database/queue/application reset");
      expect(matches[0]?.suggestion).toContain("Do not enable experimental cross-run reuse");
    });
  }
  for (const name of Object.keys(negativeLifecycle)) {
    test(`no lifecycle inference: ${name}`, () => {
      expect(findings(`no-lifecycle-${name}`, lifecycleRule.id)).toHaveLength(0);
    });
  }
  test("scans nested integration tests but not production source", () => {
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === sleepRule.id &&
          finding.location.path === "module/src/integrationTest/java/IntegrationTest.java",
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === sleepRule.id && finding.location.path === "src/main/java/NotTest.java",
      ),
    ).toBe(false);
  });
});
