import { describe, expect, test } from "bun:test";
import { collectCommandEntries } from "../src/rules/shared/any-step.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import { parseGitlabCi } from "../src/gitlab-ci-workflow.ts";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import type { WorkflowDocument } from "../src/workflow.ts";
import type { CircleCiDocument } from "../src/circleci-workflow.ts";
import type { GitlabCiDocument } from "../src/gitlab-ci-workflow.ts";
import type { PipelineDocument } from "../src/buildkite-workflow.ts";

const REPO_ROOT = "/test-repo";
const ALL_PLATFORMS: ("github-actions" | "circleci" | "gitlab-ci" | "buildkite")[] = [
  "github-actions",
  "circleci",
  "gitlab-ci",
  "buildkite",
];

function makeWorkflowDocument(yaml: string, path = ".github/workflows/test.yml"): WorkflowDocument {
  return parseWorkflow(`${REPO_ROOT}/${path}`, REPO_ROOT, yaml);
}

function makeCircleCiDocument(yaml: string, path = ".circleci/config.yml"): CircleCiDocument {
  return parseCircleCi(`${REPO_ROOT}/${path}`, REPO_ROOT, yaml);
}

function makeGitlabCiDocument(yaml: string, path = ".gitlab-ci.yml"): GitlabCiDocument {
  return parseGitlabCi(`${REPO_ROOT}/${path}`, REPO_ROOT, yaml);
}

function makePipelineDocument(yaml: string, path = ".buildkite/pipeline.yml"): PipelineDocument {
  return parsePipeline(`${REPO_ROOT}/${path}`, REPO_ROOT, yaml);
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\\\n/g, "\n").replace(/\n+/g, " ").trim();
}

function normalizedEntries(
  doc: WorkflowDocument | CircleCiDocument | GitlabCiDocument | PipelineDocument,
): { text: string; jobName: string; stepName: string }[] {
  return collectCommandEntries(doc).map((e) => ({
    text: normalize(e.text),
    jobName: e.jobName,
    stepName: e.stepName,
  }));
}

function buildCommandEquivalent(
  command: string,
  platform: "github-actions" | "circleci" | "gitlab-ci" | "buildkite",
): {
  doc: WorkflowDocument | CircleCiDocument | GitlabCiDocument | PipelineDocument;
  expectedJobName: string;
  expectedStepName: string;
} {
  switch (platform) {
    case "github-actions":
      return {
        doc: makeWorkflowDocument(`jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: ${command}
`),
        expectedJobName: "build",
        expectedStepName: command,
      };
    case "circleci":
      return {
        doc: makeCircleCiDocument(`jobs:
  build:
    docker:
      - image: node:20
    steps:
      - run:
          command: ${command}
`),
        expectedJobName: "build",
        expectedStepName: "run",
      };
    case "gitlab-ci":
      return {
        doc: makeGitlabCiDocument(`build:
  stage: build
  script:
    - ${command}
`),
        expectedJobName: "build",
        expectedStepName: "script",
      };
    case "buildkite":
      return {
        doc: makePipelineDocument(`steps:
  - label: Build
    command: ${command}
`),
        expectedJobName: "Build",
        expectedStepName: "Build",
      };
  }
}

function buildMultiCommandEquivalent(
  commands: string[],
  platform: "github-actions" | "circleci" | "gitlab-ci" | "buildkite",
): {
  doc: WorkflowDocument | CircleCiDocument | GitlabCiDocument | PipelineDocument;
} {
  switch (platform) {
    case "github-actions":
      return {
        doc: makeWorkflowDocument(`jobs:
  build:
    runs-on: ubuntu-latest
    steps:
${commands.map((c) => `      - run: ${c}`).join("\n")}
`),
      };
    case "circleci":
      return {
        doc: makeCircleCiDocument(`jobs:
  build:
    docker:
      - image: node:20
    steps:
${commands.map((c) => `      - run:\n          command: ${c}`).join("\n")}
`),
      };
    case "gitlab-ci":
      return {
        doc: makeGitlabCiDocument(`build:
  stage: build
  script:
${commands.map((c) => `    - ${c}`).join("\n")}
`),
      };
    case "buildkite":
      return {
        doc: makePipelineDocument(`steps:
${commands.map((c) => `  - label: ${c}\n    command: ${c}`).join("\n")}
`),
      };
  }
}

describe("collectCommandEntries semantic equivalence", () => {
  const commands = [
    "npm install",
    "bun test",
    "python -m pytest",
    "make build",
    "cargo build --release",
    "echo 'hello'",
    "docker build .",
    "curl -s https://example.com",
    "yarn install --frozen-lockfile",
    "pnpm install",
  ];

  test.each(ALL_PLATFORMS)("single command: %s preserves operational text", (platform) => {
    for (const cmd of commands) {
      const { doc } = buildCommandEquivalent(cmd, platform);
      const entries = normalizedEntries(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.text).toBe(normalize(cmd));
    }
  });

  test.each(ALL_PLATFORMS)("single command: %s sets correct jobName", (platform) => {
    for (const cmd of commands) {
      const { doc, expectedJobName } = buildCommandEquivalent(cmd, platform);
      const entries = collectCommandEntries(doc);
      expect(entries[0]!.jobName).toBe(expectedJobName);
    }
  });

  test.each(ALL_PLATFORMS)("multi-command: %s extracts each command", (platform) => {
    const cmds = ["npm ci", "make test", "bun run e2e"];
    const { doc } = buildMultiCommandEquivalent(cmds, platform);
    const entries = normalizedEntries(doc);
    expect(entries).toHaveLength(cmds.length);
    cmds.forEach((cmd, i) => {
      expect(entries[i]!.text).toBe(normalize(cmd));
    });
  });

  describe("semantic equivalence across platforms", () => {
    test("npm ci is semantically equivalent across all platforms", () => {
      const entriesByPlatform: Record<string, { text: string }[]> = {};
      for (const platform of ALL_PLATFORMS) {
        const { doc } = buildCommandEquivalent("npm ci", platform);
        entriesByPlatform[platform] = normalizedEntries(doc);
      }

      const normalized = Object.values(entriesByPlatform).map((e) => e[0]?.text);
      const allMatch = normalized.every((t) => t === normalize("npm ci"));
      expect(allMatch).toBe(true);
    });

    test("docker build preserves command text across all platforms", () => {
      const entriesByPlatform: Record<string, { text: string }[]> = {};
      for (const platform of ALL_PLATFORMS) {
        const { doc } = buildCommandEquivalent("docker build --push .", platform);
        entriesByPlatform[platform] = normalizedEntries(doc);
      }

      const normalized = Object.values(entriesByPlatform).map((e) => e[0]?.text);
      const expectedNormalized = normalize("docker build --push .");
      const allMatch = normalized.every((t) => t === expectedNormalized);
      expect(allMatch).toBe(true);
    });

    test("cargo test preserves command text across all platforms", () => {
      const entriesByPlatform: Record<string, { text: string }[]> = {};
      for (const platform of ALL_PLATFORMS) {
        const { doc } = buildCommandEquivalent("cargo test --all-features", platform);
        entriesByPlatform[platform] = normalizedEntries(doc);
      }

      const normalized = Object.values(entriesByPlatform).map((e) => e[0]?.text);
      const expectedNormalized = normalize("cargo test --all-features");
      const allMatch = normalized.every((t) => t === expectedNormalized);
      expect(allMatch).toBe(true);
    });
  });

  describe("multiline command equivalence", () => {
    const multilineYaml = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          set -e
          npm ci
          make build
`;

    test("GitHub Actions preserves multiline run text", () => {
      const doc = makeWorkflowDocument(multilineYaml);
      const entries = normalizedEntries(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.text).toContain("npm ci");
      expect(entries[0]!.text).toContain("make build");
      expect(entries[0]!.text).toContain("set -e");
    });
  });

  describe("cache isolation between document instances", () => {
    test("separate documents do not share cache state", () => {
      const doc1 = makeWorkflowDocument(`jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: first
`);
      const doc2 = makeWorkflowDocument(`jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - run: second
`);

      const entries1 = collectCommandEntries(doc1);
      const entries2 = collectCommandEntries(doc2);

      expect(entries1).toHaveLength(1);
      expect(entries1[0]!.text).toBe("first");
      expect(entries2).toHaveLength(1);
      expect(entries2[0]!.text).toBe("second");

      const moreEntries1 = collectCommandEntries(doc1);
      const moreEntries2 = collectCommandEntries(doc2);

      expect(moreEntries1).toHaveLength(1);
      expect(moreEntries2).toHaveLength(1);
    });
  });

  describe("command text normalization invariants", () => {
    const yamlVariants = [
      `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm install
`,
      `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          npm install
`,
      `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: "npm install"
`,
    ];

    test.each(yamlVariants)("GitHub Actions normalizes %p to consistent text", (yaml) => {
      const doc = makeWorkflowDocument(yaml);
      const entries = normalizedEntries(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.text).toContain("npm install");
    });
  });

  describe("representation transform commutativity", () => {
    test("serialized then reparsed document preserves command entries", () => {
      const original = makeWorkflowDocument(`jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: bun test
`);
      const entries1 = collectCommandEntries(original);

      const reparsed = makeWorkflowDocument(original.source!, original.path);
      const entries2 = collectCommandEntries(reparsed);

      expect(entries2.length).toBe(entries1.length);
      expect(normalizedEntries(reparsed)[0]!.text).toBe(normalizedEntries(original)[0]!.text);
    });

    test("source round-trip preserves entry count across platforms", () => {
      for (const platform of ALL_PLATFORMS) {
        const { doc: original } = buildCommandEquivalent("make build", platform);
        const originalCount = collectCommandEntries(original).length;

        if (!original.source) {
          continue;
        }

        let reparsed: typeof original;
        switch (platform) {
          case "github-actions":
            reparsed = makeWorkflowDocument(original.source, original.path);
            break;
          case "circleci":
            reparsed = makeCircleCiDocument(original.source, original.path);
            break;
          case "gitlab-ci":
            reparsed = makeGitlabCiDocument(original.source, original.path);
            break;
          case "buildkite":
            reparsed = makePipelineDocument(original.source, original.path);
            break;
        }

        const reparsedCount = collectCommandEntries(reparsed).length;
        expect(reparsedCount).toBe(originalCount);
      }
    });
  });

  describe("platform normalization preserves rule-matching substrings", () => {
    test("docker build substring is preserved across platforms", () => {
      for (const platform of ALL_PLATFORMS) {
        const { doc } = buildCommandEquivalent("docker build --push .", platform);
        const entries = collectCommandEntries(doc);
        expect(entries[0]!.text).toContain("docker build");
      }
    });

    test("npm ci substring is preserved across platforms", () => {
      for (const platform of ALL_PLATFORMS) {
        const { doc } = buildCommandEquivalent("npm ci", platform);
        const entries = collectCommandEntries(doc);
        expect(entries[0]!.text).toContain("npm ci");
      }
    });

    test("cargo test substring is preserved across platforms", () => {
      for (const platform of ALL_PLATFORMS) {
        const { doc } = buildCommandEquivalent("cargo test --all", platform);
        const entries = collectCommandEntries(doc);
        expect(entries[0]!.text).toContain("cargo test");
      }
    });

    test("curl command substring is preserved across platforms", () => {
      for (const platform of ALL_PLATFORMS) {
        const { doc } = buildCommandEquivalent("curl -s https://api.example.com", platform);
        const entries = collectCommandEntries(doc);
        expect(entries[0]!.text).toContain("curl -s");
        expect(entries[0]!.text).toContain("https://api.example.com");
      }
    });
  });

  describe("empty and non-command steps are excluded", () => {
    test("GitHub Actions uses-steps are excluded", () => {
      const doc = makeWorkflowDocument(`jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
`);
      const entries = collectCommandEntries(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.text).toBe("npm ci");
    });

    test("CircleCI non-run steps are excluded", () => {
      const doc = makeCircleCiDocument(`jobs:
  build:
    docker:
      - image: node:20
    steps:
      - checkout
      - run:
          command: npm ci
      - store_test_results:
          path: ./test-results
`);
      const entries = collectCommandEntries(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.text).toBe("npm ci");
    });

    test("Buildkite non-command steps are excluded", () => {
      const doc = makePipelineDocument(`steps:
  - wait
  - label: Build
    command: npm ci
  - block: "Deploy?"
`);
      const entries = collectCommandEntries(doc);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.text).toBe("npm ci");
    });
  });
});

describe("collectCommandEntries cross-platform rule regression prevention", () => {
  test("wasteful-npm-global-install pattern detectable across all platforms", () => {
    const pattern = "npm install -g";
    for (const platform of ALL_PLATFORMS) {
      const { doc } = buildCommandEquivalent("npm install -g typescript", platform);
      const entries = collectCommandEntries(doc);
      expect(entries[0]!.text).toContain(pattern);
    }
  });

  test("prefer-node-run-over-npm-run pattern detectable across all platforms", () => {
    const pattern = "npm run";
    for (const platform of ALL_PLATFORMS) {
      const { doc } = buildCommandEquivalent("npm run build", platform);
      const entries = collectCommandEntries(doc);
      expect(entries[0]!.text).toContain(pattern);
    }
  });

  test("docker-build-cache-disabled pattern detectable across all platforms", () => {
    for (const platform of ALL_PLATFORMS) {
      const { doc } = buildCommandEquivalent("docker build --no-cache .", platform);
      const entries = collectCommandEntries(doc);
      expect(entries[0]!.text).toContain("docker build");
      expect(entries[0]!.text).toContain("--no-cache");
    }
  });

  test("redundant-npx-or-bootstrap pattern detectable across all platforms", () => {
    for (const platform of ALL_PLATFORMS) {
      const { doc } = buildCommandEquivalent("npx eslint .", platform);
      const entries = collectCommandEntries(doc);
      expect(entries[0]!.text).toContain("npx");
    }
  });
});
