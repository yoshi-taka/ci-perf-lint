import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const setup = {
  uses: "useblacksmith/setup-docker-builder@v2",
  with: { "cache-key": "Dockerfile" },
};
const build = { uses: "useblacksmith/build-push-action@v2", with: { push: true } };
const exporting = { ...build, with: { ...build.with, "cache-to": "type=gha,mode=max" } };
const missingId = "blacksmith-docker-builder-missing";
const exportId = "blacksmith-docker-cache-export";
const metadata = {
  uses: "docker/metadata-action@9ec57ed1fcdbf14dcef7dfbe97b2010124a938b7",
  with: { images: "ghcr.io/example/app" },
};

async function analyze(
  steps: readonly Record<string, unknown>[],
  id: string,
  job: Record<string, unknown> = {},
  workflow: Record<string, unknown> = {},
) {
  const cwd = await tempDirs.create("apl-blacksmith-docker-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "Build",
      on: "push",
      ...workflow,
      jobs: {
        build: { "runs-on": "blacksmith-4vcpu-ubuntu-2404", ...job, steps },
      },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "exploratory", topCount: 1000 },
    { id, severity: "suggestion" },
  );
  return report.findings.filter((finding) => finding.ruleId === id);
}

test("missing builder is advisory and discloses cost and publication safety", async () => {
  const findings = await analyze([{ uses: "actions/checkout@v6" }, build], missingId);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("suggestion");
  expect(findings[0]?.suggestion).toContain("$0.50/GB/month");
  expect(findings[0]?.aiHandoff).toContain("Preserve publishing");
});

test("DetectMateService: metadata does not hide missing builder setup", async () => {
  expect(
    await analyze(
      [
        { uses: "actions/checkout@v6" },
        { uses: "docker/login-action@65b78e6e13532edd9afa3aa52ac7964289d1a9c1" },
        metadata,
        build,
      ],
      missingId,
    ),
  ).toHaveLength(1);
});

test("lumen: metadata preserves persistent builder evidence before GHA export", async () => {
  expect(
    await analyze(
      [
        { run: 'echo "version=1.0" >> "$GITHUB_OUTPUT"' },
        { uses: "docker/setup-qemu-action@v4" },
        setup,
        { uses: "docker/login-action@v4" },
        metadata,
        exporting,
      ],
      exportId,
    ),
  ).toHaveLength(1);
});

test("vscubing: env heredoc and date/tag metadata do not hide missing setup", async () => {
  expect(
    await analyze(
      [
        { uses: "actions/checkout@v4" },
        { run: "cat <<EOF > .env\nDATABASE_URL=${{ secrets.DATABASE_URL }}\nEOF" },
        { run: `echo "DATE_STAMP=$(date +'%Y-%m-%d_%H-%M-%S')" > "$GITHUB_ENV"` },
        {
          run: `if [ "\${{ github.ref_name }}" = "main" ]; then
  echo "ENV_TAG=production" > $GITHUB_ENV
else
  echo "ENV_TAG=staging" > $GITHUB_ENV
fi;`,
        },
        { uses: "docker/login-action@v3" },
        build,
      ],
      missingId,
    ),
  ).toHaveLength(1);
});

test.each([
  { name: "builder selection", run: "docker buildx use remote" },
  { name: "substitution execution", run: 'echo "$(docker buildx use remote)"' },
  { name: "shell input", run: "bash <<EOF\ndocker buildx use remote\nEOF" },
  { name: "heredoc substitution", run: "cat <<EOF > .env\nX=$(docker buildx use remote)\nEOF" },
  { name: "heredoc backtick", run: "cat <<EOF > .env\nX=`docker buildx use remote`\nEOF" },
  { name: "unfinished heredoc", run: "cat <<EOF > .env\nX=value" },
  { name: "environment override", run: 'echo "DOCKER_HOST=tcp://remote" >> "$GITHUB_ENV"' },
  { name: "docker config override", run: 'echo "DOCKER_CONFIG=/custom" >> "$GITHUB_ENV"' },
  { name: "loader override", run: 'echo "LD_PRELOAD=/custom.so" >> "$GITHUB_ENV"' },
  { name: "multiline override", run: `echo 'FOO=x\nBUILDX_BUILDER=remote' >> "$GITHUB_ENV"` },
  { name: "unknown environment value", run: 'echo "$CONFIG" >> "$GITHUB_ENV"' },
  { name: "formatted environment", run: `printf '%s%s=remote\\n' DOCKER_ HOST >> "$GITHUB_ENV"` },
  { name: "echo escapes", run: `echo -e 'FOO=x\\nDOCKER_HOST=remote' >> "$GITHUB_ENV"` },
  { name: "shell initialization", run: 'echo "BASH_ENV=setup.sh" >> "$GITHUB_ENV"' },
  { name: "command path", run: 'echo "/custom/bin" >> "$GITHUB_PATH"' },
  { name: "docker configuration", run: 'echo "{}" > "$HOME/.docker/config.json"' },
  { name: "script", run: "./scripts/setup-builder.sh" },
  { name: "dynamic command", run: "$SETUP_COMMAND" },
  {
    name: "date can emit environment lines",
    run: `echo "TAG=$(date +'%nDOCKER_HOST=remote')" >> "$GITHUB_ENV"`,
  },
])("metadata recognition rejects $name", async ({ run }) => {
  expect(await analyze([{ run }, build], missingId)).toHaveLength(0);
  expect(await analyze([setup, { run }, exporting], exportId)).toHaveLength(0);
});

test.each([
  `echo 'docker buildx use remote'`,
  `printf '%s\\n' 'DOCKER_HOST=tcp://remote'`,
  "# docker buildx use remote",
  `echo "ENV_TAG=production" >> "$GITHUB_ENV"`,
  `echo "version=1.0" >> "$GITHUB_OUTPUT"`,
  "cat <<'EOF' > .env\nX=$(docker buildx use remote)\nEOF",
])("harmless metadata preserves missing and configured state: %s", async (run) => {
  expect(await analyze([{ run }, build], missingId)).toHaveLength(1);
  expect(await analyze([setup, { run }, exporting], exportId)).toHaveLength(1);
});

test("non-POSIX metadata remains unknown", async () => {
  expect(await analyze([{ run: "echo ready", shell: "pwsh" }, build], missingId)).toHaveLength(0);
});

test("later setup does not erase an opaque persisted environment override", async () => {
  expect(
    await analyze(
      [{ run: 'echo "DOCKER_HOST=tcp://remote" >> "$GITHUB_ENV"' }, setup, exporting],
      exportId,
    ),
  ).toHaveLength(0);
});

test.each([
  { name: "configured builder", steps: [setup, build] },
  {
    name: "conditional setup",
    steps: [{ ...setup, if: "github.ref == 'refs/heads/main'" }, build],
  },
  { name: "other builder", steps: [{ uses: "docker/setup-buildx-action@v4" }, build] },
  { name: "explicit builder", steps: [{ ...build, with: { builder: "remote" } }] },
  { name: "unknown shell setup", steps: [{ run: "docker buildx use remote" }, build] },
  { name: "opaque action", steps: [{ uses: "./.github/actions/setup" }, build] },
  { name: "v1 setup-only action", steps: [{ uses: "useblacksmith/build-push-action@v1" }] },
  {
    name: "SHA behavior unknown",
    steps: [{ uses: `useblacksmith/build-push-action@${"a".repeat(40)}` }],
  },
  { name: "empty key", steps: [{ ...setup, with: { "cache-key": "" } }, build] },
  { name: "standard build action", steps: [{ uses: "docker/build-push-action@v7" }] },
  { name: "disabled build", steps: [{ ...build, if: false }] },
])("missing builder excludes $name", async ({ steps }) => {
  expect(await analyze(steps, missingId)).toHaveLength(0);
});

test("later setup does not satisfy an earlier build", async () => {
  expect(await analyze([build, setup], missingId)).toHaveLength(1);
});

test.each([
  { name: "GitHub runner", job: { "runs-on": "ubuntu-latest" } },
  { name: "unknown matrix runner", job: { "runs-on": "${{ matrix.runner }}" } },
  { name: "container", job: { container: "ubuntu:24.04" } },
  { name: "environment override", job: { env: { BUILDX_BUILDER: "remote" } } },
])("both rules exclude $name", async ({ job }) => {
  expect(await analyze([build], missingId, job)).toHaveLength(0);
  expect(await analyze([setup, exporting], exportId, job)).toHaveLength(0);
});

test.each(["gha", "registry", "inline"])(
  "persistent builder with %s export is advisory",
  async (backend) => {
    const findings = await analyze(
      [setup, { ...build, with: { "cache-to": `type=${backend},mode=max` } }],
      exportId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain("other runner or workflow");
    expect(findings[0]?.aiHandoff).toContain("fallback");
    expect(findings[0]?.aiHandoff).toContain("push settings");
    if (backend === "inline") {
      expect(findings[0]?.why).toContain("may have little cost");
    }
  },
);

test.each([
  { name: "no builder", steps: [exporting] },
  { name: "setup follows build", steps: [exporting, setup] },
  { name: "conditional builder", steps: [{ ...setup, if: "success()" }, exporting] },
  { name: "disabled setup", steps: [{ ...setup, if: false }, exporting] },
  { name: "missing key", steps: [{ ...setup, with: {} }, exporting] },
  {
    name: "v1 builder unknown",
    steps: [{ ...setup, uses: "useblacksmith/setup-docker-builder@v1" }, exporting],
  },
  {
    name: "subsequent builder selection",
    steps: [setup, { run: "docker buildx use other" }, exporting],
  },
  {
    name: "subsequent setup",
    steps: [setup, { uses: "docker/setup-buildx-action@v4" }, exporting],
  },
  { name: "step override", steps: [setup, { ...exporting, env: { DOCKER_HOST: "tcp://remote" } }] },
  {
    name: "explicit builder",
    steps: [setup, { ...exporting, with: { ...exporting.with, builder: "remote" } }],
  },
  { name: "import only", steps: [setup, { ...build, with: { "cache-from": "type=gha" } }] },
  {
    name: "local export",
    steps: [setup, { ...build, with: { "cache-to": "type=local,dest=/tmp/cache" } }],
  },
  {
    name: "dynamic export",
    steps: [setup, { ...build, with: { "cache-to": "${{ inputs.cache }}" } }],
  },
])("export excludes $name", async ({ steps }) => {
  expect(await analyze(steps, exportId)).toHaveLength(0);
});

test("workflow environment overrides and literal false are respected", async () => {
  expect(
    await analyze([setup, exporting], exportId, {}, { env: { DOCKER_CONTEXT: "remote" } }),
  ).toHaveLength(0);
  expect(await analyze([{ ...setup, if: "${{ false }}" }, build], missingId)).toHaveLength(1);
});

test("standard action on persistent builder does not need an exported cache", async () => {
  const standardBuild = { uses: "docker/build-push-action@v7", with: { push: true } };
  expect(await analyze([setup, standardBuild], "docker-build-without-layer-cache")).toHaveLength(0);
  expect(await analyze([standardBuild], "docker-build-without-layer-cache")).toHaveLength(1);
  expect(
    await analyze(
      [setup, { ...standardBuild, with: { "cache-to": "type=registry,ref=app:cache" } }],
      exportId,
    ),
  ).toHaveLength(1);
});

test.each([
  { platforms: "linux/arm64", runner: "blacksmith-4vcpu-ubuntu-2404", count: 1 },
  { platforms: "linux/amd64,linux/arm64", runner: "blacksmith-4vcpu-ubuntu-2404", count: 1 },
  { platforms: "linux/arm64", runner: "blacksmith-4vcpu-ubuntu-2404-arm", count: 0 },
  { platforms: "linux/amd64", runner: "blacksmith-4vcpu-ubuntu-2404", count: 0 },
])("Blacksmith QEMU: $platforms on $runner", async ({ platforms, runner, count }) => {
  expect(
    await analyze(
      [{ uses: "docker/setup-qemu-action@v4" }, { ...build, with: { platforms } }],
      "prefer-native-arm-runner-over-qemu",
      { "runs-on": runner },
    ),
  ).toHaveLength(count);
});
