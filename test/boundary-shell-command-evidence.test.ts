import { expect, test } from "bun:test";
import { shellInvocations } from "../src/rules/shared/shell-invocations.ts";
import { textDisablesDockerBuildCache, textRunsDockerBuild } from "../src/rules/shared/docker.ts";
import {
  detectBuildToolFromText,
  detectInstallCommandFromText,
  detectLintToolFromText,
  detectPythonToolFromText,
  usesLanguageInstall,
} from "../src/rules/shared/tools-text.ts";

test.each([
  "echo docker build --no-cache .",
  "printf '%s\\n' 'docker build --no-cache .'",
  "# docker build --no-cache .",
  'echo "docker build --no-cache ."',
  "echo '$(docker build --no-cache .)'",
  "echo '\\`docker build --no-cache .\\`'",
  "cat <<'EOF'\ndocker build --no-cache .\nEOF",
  "ssh worker 'docker build --no-cache .'",
  "sh -c 'docker build --no-cache .'",
  "echo \"$(cat <<'EOF'\ndocker build --no-cache .\nEOF\n)\"",
])("output or opaque payload is not a visible Docker build: %s", (text) => {
  expect(textRunsDockerBuild(text)).toBe(false);
  expect(textDisablesDockerBuildCache(text)).toBe(false);
});

test.each([
  "docker build --no-cache .",
  "sudo docker build --no-cache .",
  "env CI=1 docker buildx build --no-cache .",
  "depot build --no-cache .",
  "echo starting && docker build --no-cache . # actual build",
  'echo "$(docker build --no-cache .)"',
  "printf '%s' \"`docker build --no-cache .`\"",
  "for image in a b; do docker build --no-cache .; done",
])("visible build invocations remain detectable: %s", (text) => {
  expect(textRunsDockerBuild(text)).toBe(true);
  expect(textDisablesDockerBuildCache(text)).toBe(true);
});

test.each([
  "docker build .\necho --no-cache",
  "docker build . && printf '%s' --no-cache",
  "docker build --no-cache-filter stage .",
  "docker build --no-cache=false .",
  "docker build --no-cache --no-cache=false .",
  "docker build . # --no-cache",
  "docker build --label '--no-cache' .",
  "docker build . > --no-cache",
  "docker build . >> --no-cache",
  "docker build --no-cache-filter '--no-cache' .",
])("flags stay owned by their command: %s", (text) => {
  expect(textRunsDockerBuild(text)).toBe(true);
  expect(textDisablesDockerBuildCache(text)).toBe(false);
});

test.each(["npm install", "cargo build", "ruff check .", "oxlint ."])(
  "display and comment variants do not establish tool use: %s",
  (command) => {
    for (const text of [`echo '${command}'`, `printf '%s\\n' '${command}'`, `# ${command}`]) {
      expect(detectInstallCommandFromText(text)).toBeUndefined();
      expect(usesLanguageInstall(text)).toBe(false);
      expect(detectBuildToolFromText(command, text)).toBeUndefined();
      expect(detectLintToolFromText(command, text)).toBeUndefined();
      expect(detectPythonToolFromText(command, text)).toBeUndefined();
    }
  },
);

test.each(["npm install", "env CI=1 npm install", "sudo npm install", 'echo "$(npm install)"'])(
  "install execution stays visible: %s",
  (text) => {
    expect(detectInstallCommandFromText(text)).toBe("npm");
    expect(usesLanguageInstall(text)).toBe(true);
  },
);

test("command wrappers and build arguments remain visible", () => {
  expect(detectBuildToolFromText("", "npm run build")).toBe("npm-build");
  expect(detectBuildToolFromText("", "pnpm run build")).toBe("pnpm-build");
  expect(detectBuildToolFromText("", "npx vite build")).toBe("vite-build");
  expect(detectLintToolFromText("", "pnpm exec oxlint .")).toBe("oxlint");
  expect(detectPythonToolFromText("", "python3 -m ruff check .")).toBe("ruff");
  expect(detectBuildToolFromText("", "cargo build")).toBe("cargo-build");
  expect(detectBuildToolFromText("", "./mvnw package")).toBe("maven-package");
  expect(detectBuildToolFromText("", "./gradlew assemble")).toBe("gradle-build");
});

test("quote and substitution context is preserved", () => {
  expect(
    shellInvocations('echo "$(printf \'%s\' "$(npm install)")"').map((words) => words[0]),
  ).toContain("npm");
  expect(shellInvocations('echo "\\$(npm install)"').map((words) => words[0])).not.toContain("npm");
  expect(shellInvocations("# $(npm install)\necho ok").map((words) => words[0])).not.toContain(
    "npm",
  );
  expect(
    shellInvocations("echo '# literal' && npm install # trailing comment").map((words) => words[0]),
  ).toEqual(["echo", "npm"]);
  expect(shellInvocations("echo 'unterminated docker build")).toEqual([]);
});
