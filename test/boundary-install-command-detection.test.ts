import { describe, expect, test } from "bun:test";
import { detectInstallCommandFromText } from "../src/rules/shared/tools-text.ts";
import {
  collectPlainPipInstalls,
  detectPlainPipInstall,
  pipInstallSuggestion,
} from "../src/rules/shared/command-patterns.ts";

describe("install command boundaries", () => {
  test.each([
    ["npm ci", "npm"],
    ["npm install", "npm"],
    ["pnpm install", "pnpm"],
    ["yarn install", "yarn"],
    ["bun install", "bun"],
    ["pip install requests", "pip"],
    ["pip3 install requests", "pip"],
    ["python3.12 -m pip install requests", "pip"],
    ["pipenv install", "pipenv"],
    ["poetry install", "poetry"],
    ["uv sync", "uv"],
    ["uv pip install requests", "uv"],
    ["go mod download", "go"],
    ["mvn verify", "maven"],
    ["./mvnw package", "maven"],
    ["./gradlew build", "gradle"],
    ["sbt test", "sbt"],
    ["bundle install", "bundler"],
    ["dotnet restore", "nuget"],
    ["nuget restore", "nuget"],
    ["npm --prefix app ci", "npm"],
    ["pip --index-url https://example.com install requests", "pip"],
    ["CI=1 npm ci", "npm"],
    ["env CI=1 npm ci", "npm"],
    ["sudo npm ci", "npm"],
    ["corepack pnpm install", "pnpm"],
    ["/usr/bin/npm ci", "npm"],
    ["npm install $PACKAGES", "npm"],
    ['pip install "$PACKAGE"', "pip"],
    ["npm install --package-lock-only && npm ci", "npm"],
    ["npm ci && npm install --package-lock-only", "npm"],
    ["npm install --ignore-scripts --package-lock-only", undefined],
    ["bun install --ignore-scripts --lockfile-only", undefined],
    ["npm install --package-lock-only=false", "npm"],
    ["npm install --package-lock-only --no-package-lock-only", "npm"],
    ["npm install --package-lock-only=false --package-lock-only", undefined],
    ["npm install --prefix '--package-lock-only'", "npm"],
    ["npm install -- --package-lock-only", "npm"],
    ["npm install # --package-lock-only", "npm"],
    ["echo --package-lock-only && npm install", "npm"],
    ["bun install --lockfile-only && pip install requests", "pip"],
    ["pnpm install && npm ci", "npm"],
    ["echo 'npm ci'", undefined],
    ['printf "%s" "pip install requests"', undefined],
    ["# npm ci", undefined],
    ["npm install --help", undefined],
    ["pip --version", undefined],
    ["pipx install software", undefined],
    ["python3 -m pipenv install", undefined],
    ["npm run install", undefined],
    ["constructor install", undefined],
    ["cat <<EOF\nnpm ci\nEOF", undefined],
    ["echo '<<EOF' && npm ci", "npm"],
    ["npm install \\\n  --ignore-scripts \\\n  --package-lock-only", undefined],
    ["echo ready\n# npm install --package-lock-only\nnpm ci", "npm"],
  ] as const)("%s", (command, expected) => {
    expect(detectInstallCommandFromText(command)).toBe(expected);
  });
});

describe("plain pip invocation boundaries", () => {
  test.each([
    ["pip install requests", "pip install requests", "uv pip install requests"],
    ["pip3 install requests", "pip3 install requests", "uv pip install --python python3 requests"],
    [
      "python3.12 -m pip install requests",
      "python3.12 -m pip install requests",
      "uv pip install --python python3.12 requests",
    ],
    [
      "/opt/venv/bin/python -m pip install requests",
      "/opt/venv/bin/python -m pip install requests",
      "uv pip install --python /opt/venv/bin/python requests",
    ],
    [
      'pip install -r "requirements dev.txt"',
      'pip install -r "requirements dev.txt"',
      'uv pip install -r "requirements dev.txt"',
    ],
    ['pip install "$PACKAGE"', 'pip install "$PACKAGE"', 'uv pip install "$PACKAGE"'],
    ["uv pip install requests && pip install flask", "pip install flask", "uv pip install flask"],
    [
      "pip install requests && uv pip install flask",
      "pip install requests",
      "uv pip install requests",
    ],
    ["echo ready && pip install requests", "pip install requests", "uv pip install requests"],
    [
      "pip install requests # uv pip install flask",
      "pip install requests",
      "uv pip install requests",
    ],
    [
      "pip install \\\n  -r requirements.txt",
      "pip install   -r requirements.txt",
      "uv pip install -r requirements.txt",
    ],
    [
      "pip --disable-pip-version-check install requests",
      "pip --disable-pip-version-check install requests",
      undefined,
    ],
    [
      "pip --index-url https://example.com install requests",
      "pip --index-url https://example.com install requests",
      undefined,
    ],
    [
      "pip install --disable-pip-version-check requests",
      "pip install --disable-pip-version-check requests",
      undefined,
    ],
    [
      "env PIP_INDEX_URL=https://example.com pip install requests",
      "env PIP_INDEX_URL=https://example.com pip install requests",
      undefined,
    ],
    ["/opt/venv/bin/pip install requests", "/opt/venv/bin/pip install requests", undefined],
    ["python3 -I -m pip install requests", "python3 -I -m pip install requests", undefined],
    ["pip --log install install requests", "pip --log install install requests", undefined],
    ["pip --log install list", undefined, undefined],
    ["echo 'pip install requests'", undefined, undefined],
    ['printf "%s" "pip install requests"', undefined, undefined],
    ["# pip install requests", undefined, undefined],
    ["uv pip install requests", undefined, undefined],
    ["pipenv install", undefined, undefined],
    ["pipx install software", undefined, undefined],
    ["python3 -m pipenv install", undefined, undefined],
    ["pip2 install requests", undefined, undefined],
    ["python2 -m pip install requests", undefined, undefined],
    ["pip install --help", undefined, undefined],
    ["pip --help install requests", undefined, undefined],
    ["pip install --dry-run requests", undefined, undefined],
    ["cat <<EOF\npip install requests\nEOF", undefined, undefined],
    ["sh -c 'pip install requests'", undefined, undefined],
  ] as const)("%s", (text, command, replacement) => {
    const install = detectPlainPipInstall(text);
    if (command === undefined) {
      expect(install).toBeUndefined();
    } else {
      expect(install?.command).toBe(command);
      expect(install?.replacement).toBe(replacement);
    }
  });
  test("all plain installs are collected independently", () => {
    expect(
      collectPlainPipInstalls(
        "pip install requests && uv pip install pytest && pip install flask",
      ).map((install) => install.command),
    ).toEqual(["pip install requests", "pip install flask"]);
  });
  test("pip-only global options receive migration guidance", () => {
    const install = detectPlainPipInstall("pip --disable-pip-version-check install requests");
    expect(install).toBeDefined();
    expect(pipInstallSuggestion(install!)).toContain("translating pip-specific options");
    expect(pipInstallSuggestion(install!)).not.toContain("uv pip --disable-pip-version-check");
  });
});
