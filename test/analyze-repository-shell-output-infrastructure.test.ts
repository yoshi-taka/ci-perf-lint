import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(commands: string[], runner = "ubuntu-latest", allPlatforms = false) {
  const cwd = await tempDirs.create("apl-shell-infra-");
  await writeRepositoryFiles(cwd, {
    "docker-bake.hcl": 'target "default" { context = "." }',
    ".github/workflows/ci.yml": stringify({
      on: "push",
      jobs: {
        check: {
          "runs-on": runner,
          steps: commands.map((run) => ({
            name: "terraform init / xcodes install / docker build",
            run,
          })),
        },
      },
    }),
    ...(allPlatforms
      ? {
          ".buildkite/pipeline.yml": stringify({
            steps: commands.map((command) => ({ label: "check", command })),
          }),
          ".gitlab-ci.yml": stringify({ check: { script: commands } }),
          ".circleci/config.yml": stringify({
            version: 2.1,
            jobs: {
              check: {
                docker: [{ image: "cimg/base:stable" }],
                steps: commands.map((command) => ({ run: command })),
              },
            },
          }),
        }
      : {}),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.scope !== "repository");
}

test.each([
  ["docker-bake-file-unused-in-ci", "docker build .", "ubuntu-latest"],
  [
    "prefer-zstd-compression-for-pushed-docker-images",
    "docker buildx build --push .",
    "ubuntu-latest",
  ],
  [
    "consider-caching-os-packages-or-using-a-custom-image",
    "sudo apt-get install -y clang ninja-build",
    "ubuntu-latest",
  ],
  ["cache-terraform-providers", "terraform init", "ubuntu-latest"],
  ["avoid-xcode-install-on-hosted-macos", "xcodes install 16.4", "macos-latest"],
  ["avoid-brew-update-on-hosted-macos", "brew update", "macos-latest"],
] as const)(
  "%s distinguishes execution from displayed commands",
  async (ruleId, command, runner) => {
    for (const variant of ["actual", "echo", "printf", "comment", "substitution"]) {
      const run =
        variant === "actual"
          ? command
          : variant === "comment"
            ? `# ${command}\necho done`
            : variant === "substitution"
              ? `echo "$( ${command} )"`
              : `${variant} '%s' '${command}'`;
      const findings = await scan([run], runner);
      expect(findings.some((finding) => finding.ruleId === ruleId)).toBe(
        variant === "actual" || variant === "substitution",
      );
    }
  },
);

test.each([
  "echo 'docker buildx bake'",
  "printf '%s' 'docker buildx bake'",
  "# docker buildx bake",
])("printed bake usage cannot suppress four CI formats: %s", async (display) => {
  const findings = await scan(["docker build .", display], "ubuntu-latest", true);
  expect(
    findings.filter((finding) => finding.ruleId === "docker-bake-file-unused-in-ci"),
  ).toHaveLength(4);
});

test("actual bake retains its exemption in four CI formats", async () => {
  const findings = await scan(["docker build .", "docker buildx bake"], "ubuntu-latest", true);
  expect(findings.some((finding) => finding.ruleId === "docker-bake-file-unused-in-ci")).toBe(
    false,
  );
});

test.each([
  ["docker buildx build .\necho --push", false],
  ["docker buildx build --label type=registry .", false],
  ["docker buildx build --push=false .", false],
  ["docker buildx build --push .\necho compression=zstd,oci-mediatypes=true", true],
  ["docker buildx build --push --label compression=zstd,oci-mediatypes=true .", true],
  ["docker buildx build --output type=registry,compression=zstd,oci-mediatypes=true .", false],
  ["depot build --push -otype=registry,compression=zstd,oci-mediatypes=true .", false],
  [
    "docker buildx build --push .\ndocker buildx build --output type=registry,compression=zstd,oci-mediatypes=true .",
    true,
  ],
  [
    "docker buildx build --output type=registry --output type=registry,compression=zstd,oci-mediatypes=true .",
    true,
  ],
  [
    "docker buildx build --push --output type=local,dest=out,compression=zstd,oci-mediatypes=true .",
    true,
  ],
] as const)("BuildKit exporter options belong to their build: %s", async (command, expected) => {
  const findings = await scan([command]);
  expect(
    findings.some(
      (finding) => finding.ruleId === "prefer-zstd-compression-for-pushed-docker-images",
    ),
  ).toBe(expected);
});

test("OS package counts do not include later output", async () => {
  const findings = await scan(["sudo apt-get install jq\necho clang ninja-build", "npm run build"]);
  const finding = findings.find(
    (entry) => entry.ruleId === "consider-caching-os-packages-or-using-a-custom-image",
  );
  expect(finding?.severity).toBe("suggestion");
});

test("sudo environment assignments and Terraform chdir remain executable", async () => {
  const findings = await scan([
    "sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y jq",
    "terraform -chdir=infra init",
  ]);
  expect(
    findings.some(
      (finding) => finding.ruleId === "consider-caching-os-packages-or-using-a-custom-image",
    ),
  ).toBe(true);
  expect(findings.some((finding) => finding.ruleId === "cache-terraform-providers")).toBe(true);
});

test.each([
  "xcversion install 15.4",
  "mise install xcode@16.4",
  "xip --expand Xcode_16.4.xip",
  "curl -L https://example.invalid/Xcode_16.4.xip -o Xcode_16.4.xip",
  "wget -O Xcode_16.4.xip https://example.invalid/Xcode_16.4.xip",
])("Xcode install variants remain detected: %s", async (command) => {
  const findings = await scan([command], "macos-latest");
  expect(findings.some((finding) => finding.ruleId === "avoid-xcode-install-on-hosted-macos")).toBe(
    true,
  );
});

test("Xcode version comes from the install, not printed text", async () => {
  const findings = await scan(["echo 'xcodes install 99.9'\nxcodes install 16.4"], "macos-latest");
  const finding = findings.find((entry) => entry.ruleId === "avoid-xcode-install-on-hosted-macos");
  expect(finding?.message).toContain("16.4");
  expect(finding?.message).not.toContain("99.9");
});

test("Xcode URL used as curl data is not a download", async () => {
  const findings = await scan(
    ["curl --data https://example.invalid/Xcode_16.4.xip https://example.invalid/api"],
    "macos-latest",
  );
  expect(findings.some((finding) => finding.ruleId === "avoid-xcode-install-on-hosted-macos")).toBe(
    false,
  );
});
