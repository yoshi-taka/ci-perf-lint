import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

describe("Dockerfile package version constraints", () => {
  test.each([
    {
      name: "article example",
      run: "apt-get update && apt-get install -y some-package",
      packages: ["some-package"],
    },
    {
      name: "mixed pinned and unpinned packages",
      run: "apt-get install -y curl=1.2.* git:amd64 ca-certificates",
      packages: ["git:amd64", "ca-certificates"],
    },
    {
      name: "apt alias and flags before install",
      run: "apt -qq -o Dpkg::Use-Pty=0 install -y curl",
      packages: ["curl"],
    },
    {
      name: "option values and quoted packages",
      run: "apt-get install --target-release bookworm -o Dpkg::Use-Pty=0 --config-file /tmp/apt.conf 'curl' \"git=2.0.*\" --no-install-recommends",
      packages: ["curl"],
    },
    {
      name: "multiline install",
      run: "apt-get update && \\\n    apt-get install -y \\\n    curl=1.2.* \\\n    git",
      packages: ["git"],
    },
    {
      name: "pinned install with combined flags before subcommand and cleanup",
      run: "apt-get update \\\n    && apt-get -yqq --no-install-recommends install nodejs=0.10 \\\n    && rm -rf /var/lib/apt/lists/*",
      packages: [],
    },
    {
      name: "unpinned install with combined flags before subcommand and cleanup",
      run: "apt-get update \\\n    && apt-get -yqq --no-install-recommends install nodejs \\\n    && rm -rf /var/lib/apt/lists/*",
      packages: ["nodejs"],
    },
    {
      name: "multiline wildcard and epoch version pins",
      run: "apt-get update && apt-get install --no-install-recommends -y \\\n    python-demjson=2.2.2* \\\n    wget=1.16.1* \\\n    git=1:2.5.0* \\\n    ruby=1:2.1.*",
      packages: [],
    },
    {
      name: "short target-release option with pinned backport",
      run: "apt-get update && apt-get install -y --no-install-recommends -t bookworm-backports openjdk-21-jdk=21.0.1+12-1~bpo12+1 && rm -rf /var/lib/apt/lists/*",
      packages: [],
    },
    {
      name: "short target-release option does not pin package",
      run: "apt-get install -y -t bookworm-backports openjdk-21-jdk",
      packages: ["openjdk-21-jdk"],
    },
    {
      name: "local deb does not hide an unpinned repository package",
      run: "apt-get install ./wkhtmltox_0.12.5-1.bionic_amd64.deb curl",
      packages: ["curl"],
    },
    {
      name: "simple wrappers",
      run: "sudo apt-get install curl && env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get install git",
      packages: ["curl", "git"],
    },
    {
      name: "BuildKit mounts",
      run: "--mount=type=cache,target=/var/cache/apt --mount=type=cache,target=/var/lib/apt apt-get install curl",
      packages: ["curl"],
    },
    {
      name: "shell boundaries and redirection",
      run: "apt-get install curl>/tmp/log; echo done && apt-get install git",
      packages: ["curl", "git"],
    },
    {
      name: "release selector is not a version pin",
      run: "apt-get install curl/bookworm",
      packages: ["curl/bookworm"],
    },
    {
      name: "exact, wildcard, and dynamic version pins",
      run: "apt-get install curl:amd64=1.2.3 git=2.* ca-certificates=${CA_VERSION}",
      packages: [],
    },
    {
      name: "dynamic package lists and local debs",
      run: "apt-get install $PACKAGES ${EXTRA_PACKAGES} ./local.deb /tmp/other.deb local.deb",
      packages: [],
    },
    { name: "non-install operations", run: "apt-get update && apt-get remove curl", packages: [] },
    {
      name: "quoted command text is not executed",
      run: "echo 'apt-get install curl' && printf \"apt install git\"",
      packages: [],
    },
    {
      name: "comments do not supply packages",
      run: "apt-get install curl=1.2.* # apt-get install git",
      packages: [],
    },
    { name: "option-only install", run: "apt-get install -y -o Dpkg::Use-Pty=0", packages: [] },
    { name: "package removal argument", run: "apt-get install curl-", packages: [] },
    {
      name: "explicit install suffix is not a version pin",
      run: "apt-get install curl+ libstdc++:amd64+ git-",
      packages: ["curl+", "libstdc++:amd64+"],
    },
    {
      name: "explicit install suffix with version pins",
      run: "apt-get install curl=1.2.3+ libstdc++:amd64=12.*+",
      packages: [],
    },
    {
      name: "ONBUILD shell install",
      instruction: "ONBUILD RUN",
      run: "apt-get update && apt-get install -y curl",
      packages: ["curl"],
    },
    {
      name: "ONBUILD multiline mixed version constraints",
      instruction: "ONBUILD RUN",
      run: "apt-get install -y \\\n    curl=1.2.* \\\n    git+",
      packages: ["git+"],
    },
    {
      name: "ONBUILD pinned shell install",
      instruction: "ONBUILD RUN",
      run: "apt-get install curl=1.2.3 git=2.*",
      packages: [],
    },
    {
      name: "ONBUILD direct JSON exec form",
      instruction: "ONBUILD RUN",
      run: '["apt-get", "install", "-y", "curl+", "git=2.*"]',
      packages: ["curl+"],
    },
    {
      name: "ONBUILD pinned JSON exec form",
      instruction: "ONBUILD RUN",
      run: '["apt-get", "install", "curl=1.2.3"]',
      packages: [],
    },
    {
      name: "ONBUILD quoted command text is not executed",
      instruction: "ONBUILD RUN",
      run: "echo 'apt-get install curl'",
      packages: [],
    },
    {
      name: "ONBUILD non-RUN instruction is not executed during build",
      instruction: "ONBUILD CMD",
      run: '["apt-get", "install", "curl"]',
      packages: [],
    },
    {
      name: "ONBUILD and ordinary installs aggregate at original instruction lines",
      instruction: "ONBUILD RUN",
      run: "apt-get install curl\nRUN apt install git",
      packages: ["curl", "git"],
      details: "line 2: curl; line 3: git",
    },
    {
      name: "direct JSON exec form",
      run: '["apt-get", "install", "-y", "curl", "git=2.*"]',
      packages: ["curl"],
    },
    {
      name: "heredoc data is not parsed as commands",
      run: "cat <<EOF\napt-get install curl\nEOF",
      packages: [],
    },
    {
      name: "multiple installs aggregate and deduplicate packages",
      run: "apt-get install curl curl\nRUN apt install git",
      packages: ["curl", "git"],
      details: "line 2: curl; line 3: git",
    },
  ])("$name", async (scenario) => {
    const { run, packages } = scenario;
    const fixtureRoot = await tempDirs.create("apl-docker-package-versions-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      "name: docker\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n      - run: docker build .\n",
    );
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      `FROM debian:bookworm-slim\n${"instruction" in scenario ? scenario.instruction : "RUN"} ${run}\n`,
    );
    const options = { cwd: fixtureRoot, targetPath: ".", topCount: 100 };
    const report = await analyzeRepository({ ...options, mode: "exploratory" });
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "dockerfile-apt-install-without-version-pin",
    );
    expect(findings).toHaveLength(packages.length ? 1 : 0);
    if (packages.length) {
      expect(findings[0]?.severity).toBe("suggestion");
      expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: 2, column: 1 });
      expect(findings[0]?.message).toBe(
        `Dockerfile Dockerfile installs apt packages without version pins: ${"details" in scenario ? scenario.details : `line 2: ${packages.join(", ")}`}.`,
      );
    }
    if (run === "apt-get update && apt-get install -y some-package") {
      const strict = await analyzeRepository({ ...options, mode: "strict" });
      expect(
        strict.findings.some(
          (finding) => finding.ruleId === "dockerfile-apt-install-without-version-pin",
        ),
      ).toBe(false);
    }
  });
});
