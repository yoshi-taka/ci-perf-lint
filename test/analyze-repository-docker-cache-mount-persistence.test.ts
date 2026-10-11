import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const cacheRules = [
  "dockerfile-go-mod-download-without-cache-mount",
  "dockerfile-go-build-without-cache-mount",
];
const dockerfile =
  'FROM golang:1.24\nCOPY go.mod go.sum ./\nRUN go mod download\nCOPY . .\nRUN go build -o /app .\nCMD ["/app"]\n';
afterEach(async () => {
  await tempDirs.cleanup();
});

function gha(steps: string[], runner = "ubuntu-latest") {
  return [
    "name: docker",
    "on: push",
    "jobs:",
    "  image:",
    `    runs-on: ${runner}`,
    "    steps:",
    ...steps
      .join("\n")
      .split("\n")
      .map((line) => `      ${line}`),
  ].join("\n");
}
const dockerAction = "- uses: docker/build-push-action@v6\n  with:\n    context: .";
const depotAction = "- uses: depot/build-push-action@v1\n  with:\n    context: .";
const blacksmithSetup =
  "- uses: useblacksmith/setup-docker-builder@v2\n  with:\n    cache-key: Dockerfile";

async function analyzeFiles(files: Record<string, string>, withMounts = false) {
  const root = await tempDirs.create("apl-cache-persistence-");
  const contents = {
    "go.mod": "module example.com/app\n\ngo 1.24\n",
    "go.sum": "",
    Dockerfile: withMounts
      ? dockerfile
          .replace(
            "RUN go mod download",
            "RUN --mount=type=cache,target=/go/pkg/mod go mod download",
          )
          .replace("RUN go build", "RUN --mount=type=cache,target=/root/.cache/go-build go build")
      : dockerfile,
    ...files,
  };
  for (const [name, text] of Object.entries(contents)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 100 });
}

describe("cache mount warnings require a persistent build path", () => {
  test.each([
    ["Depot action", gha([depotAction])],
    ["Depot CLI", gha(["- run: depot build --project example -f Dockerfile ."])],
    [
      "Blacksmith build action",
      gha(
        [blacksmithSetup, "- uses: useblacksmith/build-push-action@v2\n  with:\n    context: ."],
        "blacksmith-4vcpu-ubuntu-2404",
      ),
    ],
    ["Blacksmith with Docker action", gha([blacksmithSetup, dockerAction])],
    ["Blacksmith CLI", gha([blacksmithSetup, "- run: docker buildx build ."])],
    ["Blacksmith v1 setup", gha(["- uses: useblacksmith/setup-docker-builder@v1", dockerAction])],
  ])("warns for %s without cache mounts", async (_name, workflow) => {
    const report = await analyzeFiles({ ".github/workflows/docker.yml": workflow });
    for (const ruleId of cacheRules) {
      const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.workflow).toBe(".github/workflows/docker.yml");
    }
  });

  test.each([
    ["plain Docker action", gha([dockerAction])],
    [
      "GHA layer cache",
      gha([`${dockerAction}\n    cache-from: type=gha\n    cache-to: type=gha,mode=max`]),
    ],
    ["plain self-hosted", gha([dockerAction], "self-hosted")],
    ["Blacksmith runner alone", gha([dockerAction], "blacksmith-4vcpu-ubuntu-2404")],
    [
      "Blacksmith action alone",
      gha(["- uses: useblacksmith/build-push-action@v2\n  with:\n    context: ."]),
    ],
    ["Depot setup alone", gha(["- uses: depot/setup-action@v1", dockerAction])],
    ["Blacksmith setup after build", gha([dockerAction, blacksmithSetup])],
    [
      "conditional setup",
      gha([`${blacksmithSetup}\n  if: github.ref == 'refs/heads/main'`, dockerAction]),
    ],
    [
      "v2 setup without cache key",
      gha(["- uses: useblacksmith/setup-docker-builder@v2", dockerAction]),
    ],
    ["disabled setup", gha([`${blacksmithSetup}\n  if: false`, dockerAction])],
    [
      "Docker context switched",
      gha([blacksmithSetup, "- run: docker context use other", dockerAction]),
    ],
    [
      "builder replaced by action",
      gha([blacksmithSetup, "- uses: docker/setup-buildx-action@v3", dockerAction]),
    ],
    [
      "builder switched in shell",
      gha([blacksmithSetup, "- run: docker buildx use default", dockerAction]),
    ],
    ["explicit other builder", gha([blacksmithSetup, `${dockerAction}\n    builder: other`])],
    [
      "step env override",
      gha([blacksmithSetup, `${dockerAction}\n  env:\n    BUILDX_BUILDER: other`]),
    ],
    [
      "CLI builder override",
      gha([blacksmithSetup, "- run: docker buildx build --builder default ."]),
    ],
    ["plain docker CLI bypasses active builder", gha([blacksmithSetup, "- run: docker build ."])],
    ["Depot fallback enabled", gha([`${depotAction}\n    buildx-fallback: true`])],
    [
      "Depot fallback unknown",
      gha([`${depotAction}\n    buildx-fallback: \${{ inputs.fallback }}`]),
    ],
    ["script only", gha(["- run: ./build-with-depot.sh"])],
    ["quoted fake command", gha(['- run: echo "hello; depot build ."'])],
  ])("does not infer persistence from %s", async (_name, workflow) => {
    const report = await analyzeFiles({ ".github/workflows/docker.yml": workflow });
    expect(report.findings.filter((finding) => cacheRules.includes(finding.ruleId))).toEqual([]);
  });

  test("does not share setup across jobs", async () => {
    const workflow = `${gha([blacksmithSetup])}\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n`;
    const report = await analyzeFiles({ ".github/workflows/docker.yml": workflow });
    expect(report.findings.filter((finding) => cacheRules.includes(finding.ruleId))).toEqual([]);
  });

  test("keeps qualifying workflow attribution when another workflow builds the same Dockerfile first", async () => {
    const report = await analyzeFiles({
      ".github/workflows/a.yml": gha([dockerAction]),
      ".github/workflows/z.yml": gha([depotAction]),
    });
    for (const ruleId of cacheRules) {
      const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.workflow).toBe(".github/workflows/z.yml");
    }
  });

  test("does not enable unrelated Dockerfiles and resolves CLI working directories", async () => {
    const report = await analyzeFiles({
      ".github/workflows/docker.yml": gha([
        dockerAction,
        "- run: depot build .\n  working-directory: service",
      ]),
      "service/Dockerfile": dockerfile,
      "service/go.mod": "module example.com/service\n\ngo 1.24\n",
    });
    for (const ruleId of cacheRules) {
      expect(
        report.findings
          .filter((finding) => finding.ruleId === ruleId)
          .map((finding) => finding.location.path),
      ).toEqual(["service/Dockerfile"]);
    }
  });

  test("mount-present negatives still apply on Depot", async () => {
    const report = await analyzeFiles({ ".github/workflows/docker.yml": gha([depotAction]) }, true);
    expect(report.findings.filter((finding) => cacheRules.includes(finding.ruleId))).toEqual([]);
  });

  test.each([
    ["Depot", "steps:\n  - command: depot build .\n"],
    [
      "explicit local state",
      "steps:\n  - cache: /var/lib/docker\n    command: docker buildx build --builder default .\n",
    ],
    [
      "pipeline state and local env",
      "cache:\n  paths:\n    - /var/lib/docker\nenv:\n  BUILDX_BUILDER: default\nsteps:\n  - command: docker buildx build .\n",
    ],
  ])("recognizes Buildkite %s", async (_name, pipeline) => {
    const report = await analyzeFiles({ ".buildkite/pipeline.yml": pipeline });
    for (const ruleId of cacheRules) {
      const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.workflow).toBe(".buildkite/pipeline.yml");
    }
  });

  test.each([
    "steps:\n  - command: docker buildx build .\n",
    "steps:\n  - agents:\n      queue: persistent\n    command: docker buildx build .\n",
    "steps:\n  - cache: /root/.cache/go-build\n    command: docker buildx build --builder default .\n",
    "steps:\n  - cache: /var/lib/docker\n    command: docker buildx build .\n",
    "steps:\n  - cache: /var/lib/docker\n    command: docker buildx build --builder remote .\n",
    "steps:\n  - cache: /var/lib/docker\n    env:\n      DOCKER_HOST: tcp://other:2375\n    command: docker buildx build --builder default .\n",
    'steps:\n  - cache: /var/lib/docker\n    env:\n      DOCKER_BUILDKIT: "0"\n    command: docker build --builder default .\n',
    "steps:\n  - cache: /var/lib/docker\n    command: |\n      export DOCKER_HOST=tcp://other:2375\n      docker buildx build --builder default .\n",
  ])("abstains on uncertain Buildkite persistence", async (pipeline) => {
    const report = await analyzeFiles({ ".buildkite/pipeline.yml": pipeline });
    expect(report.findings.filter((finding) => cacheRules.includes(finding.ruleId))).toEqual([]);
  });
});
