import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "missing-make-j-flag";

async function scan(
  job: Record<string, unknown>,
  options: { workflow?: Record<string, unknown>; files?: Record<string, string> } = {},
) {
  const root = await tempDirs.create("apl-make-context-");
  const dir = path.join(root, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "ci.yml"),
    stringify({
      name: "Build CI",
      on: "push",
      ...options.workflow,
      jobs: { build: { "runs-on": "ubuntu-latest", ...job } },
    }),
  );
  for (const [file, text] of Object.entries(options.files ?? {})) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("Make parallel controls and command context", () => {
  test.each([
    ["make build && echo --jobs=4", true],
    ["make build # -j4", true],
    ['make -f "serial -j4.mk" build', true],
    ["make -j4 build && make test", true],
    ["echo ready\nmake build", true],
    ["make -j$(nproc) build", false],
    ["make -C $(pwd) -j4 build", false],
    ["cmake --build $(pwd) --parallel", false],
    ["MAKEFLAGS=-j4 make build", false],
    ["echo 'make build'", false],
    ["cat <<EOF\nmake build\nEOF", false],
  ] as const)("%s", async (command, expected) => {
    expect(await scan({ steps: [{ run: command }] })).toHaveLength(expected ? 1 : 0);
  });
  test.each([
    { workflow: "-j4", job: "", step: undefined, expected: true },
    { workflow: "-j4", job: undefined, step: "", expected: true },
    { workflow: "", job: "--jobs=4", step: undefined, expected: false },
    { workflow: "-j4", job: "", step: "-j2", expected: false },
  ])("MAKEFLAGS override: $workflow / $job / $step", async (scenario) => {
    const findings = await scan(
      {
        ...(scenario.job === undefined ? {} : { env: { MAKEFLAGS: scenario.job } }),
        steps: [
          {
            run: "make build",
            ...(scenario.step === undefined ? {} : { env: { MAKEFLAGS: scenario.step } }),
          },
        ],
      },
      { workflow: { env: { MAKEFLAGS: scenario.workflow } } },
    );
    expect(findings).toHaveLength(scenario.expected ? 1 : 0);
  });
  test("CMake parallel ENV cannot tune an unrelated Make command", async () => {
    expect(
      await scan({ env: { CMAKE_BUILD_PARALLEL_LEVEL: 4 }, steps: [{ run: "make build" }] }),
    ).toHaveLength(1);
  });
  test("empty step ENV clears inherited CMake tuning", async () => {
    expect(
      await scan(
        { steps: [{ run: "cmake --build build", env: { CMAKE_BUILD_PARALLEL_LEVEL: "" } }] },
        { workflow: { env: { CMAKE_BUILD_PARALLEL_LEVEL: 4 } } },
      ),
    ).toHaveLength(1);
  });
  test.each([
    ["cmake -S . -B build -G Ninja\ncmake --build build", false],
    ["echo Ninja\ncmake --build build", true],
    ["cmake -S . -B other -G Ninja\ncmake --build build", true],
    ["cmake --build build\ncmake -S . -B build -G Ninja", true],
    ["cmake -S . -B build -G Ninja\ncmake --build build\ncmake --build other", true],
    ["cmake -S . -B . -G Ninja\ncmake --version\ncmake --build .", false],
  ] as const)("Ninja proof: %s", async (command, expected) => {
    expect(await scan({ steps: [{ run: command }] })).toHaveLength(expected ? 1 : 0);
  });
  test("internal tool evidence uses the command's -C directory", async () => {
    expect(
      await scan(
        { steps: [{ run: "make -C app test" }] },
        { files: { "app/Makefile": "test:\n\tgo test ./...\n" } },
      ),
    ).toEqual([]);
  });
  test("workflow defaults locate the applicable Makefile", async () => {
    expect(
      await scan(
        { steps: [{ run: "make test" }] },
        {
          workflow: { defaults: { run: { "working-directory": "app" } } },
          files: { "app/Makefile": "test:\n\tgo test ./...\n" },
        },
      ),
    ).toEqual([]);
  });
  test("an unrelated root Makefile cannot tune a subdirectory build", async () => {
    expect(
      await scan(
        { steps: [{ run: "make -C app test" }] },
        {
          files: { Makefile: "test:\n\tgo test ./...\n", "app/Makefile": "test:\n\tgcc main.c\n" },
        },
      ),
    ).toHaveLength(1);
  });
  test("custom Makefile selection cannot borrow the default Makefile", async () => {
    expect(
      await scan(
        { steps: [{ run: "make -f other.mk test" }] },
        { files: { Makefile: "test:\n\tgo test ./...\n", "other.mk": "test:\n\tgcc main.c\n" } },
      ),
    ).toHaveLength(1);
  });
  test("an unused Go variable does not tune a serial recipe", async () => {
    expect(
      await scan(
        { steps: [{ run: "make build" }] },
        { files: { Makefile: "GOTEST = go test\nbuild:\n\tgcc main.c\n" } },
      ),
    ).toHaveLength(1);
  });
  test("echoed Go text does not tune a serial recipe", async () => {
    expect(
      await scan(
        { steps: [{ run: "make build" }] },
        { files: { Makefile: "build:\n\techo 'go test'\n\tgcc main.c\n" } },
      ),
    ).toHaveLength(1);
  });
  test.each(["vercel", "wrangler", "amplify"])(
    "repository command parsing: %s",
    async (surface) => {
      const name =
        surface === "vercel"
          ? "vercel.json"
          : surface === "wrangler"
            ? "wrangler.toml"
            : "amplify.yml";
      const config = (command: string) =>
        surface === "vercel"
          ? JSON.stringify({ buildCommand: command })
          : surface === "wrangler"
            ? `[build]\ncommand = ${JSON.stringify(command)}\n`
            : stringify({ version: 1, frontend: { phases: { build: { commands: [command] } } } });
      const options = {
        files: {
          "package.json": '{"name":"make-config"}',
          [name]: config("make build && echo --jobs=4"),
        },
      };
      const findings = await scan({ steps: [{ run: "echo ready" }] }, options);
      expect(findings.filter((finding) => finding.location.path === name)).toHaveLength(1);
      const tuned = await scan(
        { steps: [{ run: "echo ready" }] },
        {
          files: {
            "package.json": '{"name":"make-config"}',
            [name]: config("MAKEFLAGS=-j4 make build"),
          },
        },
      );
      expect(tuned.filter((finding) => finding.location.path === name)).toEqual([]);
    },
  );
});
