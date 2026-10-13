import { describe, expect, test } from "bun:test";
import { collectTestWorkerCommands } from "../src/rules/shared/test-worker-commands.ts";

describe("test worker option ownership", () => {
  test.each([
    ["npx jest", [false]],
    ['npx jest --testNamePattern "slow --maxWorkers=2"', [false]],
    ['jest --testPathIgnorePatterns "folder --runInBand"', [false]],
    ["jest --maxWorkers=2", [true]],
    ["jest --maxWorkers 50%", [true]],
    ["jest -w2", [true]],
    ["jest -w 2", [true]],
    ["jest -i", [true]],
    ["jest --runInBand=false", [false]],
    ["jest --runInBand --no-runInBand", [false]],
    ["jest --runInBand=false --runInBand", [true]],
    ["jest -- --maxWorkers=2", [false]],
    ['vitest --testNamePattern "slow --pool=forks"', [false]],
    ["vitest --pool forks", [true]],
    ["vitest --maxWorkers=2", [true]],
    ["vitest --poolOptions.threads.maxThreads=2", [true]],
    ["vitest --no-file-parallelism", [true]],
    ['playwright test --grep "smoke --workers=2"', [false]],
    ["playwright test -j2", [true]],
    ["playwright test --workers 25%", [true]],
    ['pytest -k "smoke -n 2"', [false]],
    ["pytest -n auto", [true]],
    ["pytest -n logical", [true]],
    ["pytest -n0", [true]],
    ["pytest --numprocesses=2", [true]],
    ["pytest -- --numprocesses=2", [false]],
    ["python3.12 -m pytest", [false]],
    ["uv run pytest -n2", [true]],
    ["npx --yes jest --maxWorkers=2", [true]],
    ["pnpm exec jest -w2", [true]],
    ["echo --maxWorkers=2 && jest", [false]],
    ["jest --maxWorkers=2 && jest", [true, false]],
    ["jest # --maxWorkers=2", [false]],
    ["jest --help", []],
    ["playwright test --list", []],
    ["pytest --collect-only", []],
    ["echo 'jest --maxWorkers=2'", []],
    ["playwright install", []],
    ["cat <<EOF\njest\nEOF", []],
  ] as const)("%s", (text, expected) => {
    expect(collectTestWorkerCommands(text).map((command) => command.tuned)).toEqual([...expected]);
  });
  test("config values cannot be borrowed from test-name expressions", () => {
    const command = collectTestWorkerCommands(
      'jest --testNamePattern "suite --config=tuned.js" --config other.js',
    )[0];
    expect(command?.config).toBe("other.js");
  });
  test("config paths preserve spaces and later selections", () => {
    expect(collectTestWorkerCommands('vitest --config "config files/vitest.ts"')[0]?.config).toBe(
      "config files/vitest.ts",
    );
    expect(collectTestWorkerCommands("jest -c first.js --config=last.js")[0]?.config).toBe(
      "last.js",
    );
  });
  test("inline Jest config is independent of default files", () => {
    expect(collectTestWorkerCommands("jest --config='{\"maxWorkers\":2}'")[0]?.tuned).toBe(true);
    expect(
      collectTestWorkerCommands("jest --config='{\"maxWorkers\":2}' --config other.js")[0]?.tuned,
    ).toBe(false);
    expect(collectTestWorkerCommands("jest --config='{}'")[0]?.config).toBeNull();
  });
  test("pytest addopts overrides use their own option scope", () => {
    const clear = collectTestWorkerCommands("pytest -o addopts=")[0];
    expect(clear?.configOverridden).toBe(true);
    expect(clear?.tuned).toBe(false);
    expect(collectTestWorkerCommands("pytest -oaddopts='-n logical'")[0]?.tuned).toBe(true);
    expect(collectTestWorkerCommands("pytest -oaddopts=-n2 -oaddopts=")[0]?.tuned).toBe(false);
    expect(
      collectTestWorkerCommands("pytest -oaddopts=", { PYTEST_ADDOPTS: "-oaddopts=-n2" })[0]?.tuned,
    ).toBe(false);
    expect(
      collectTestWorkerCommands("pytest --override-ini=cache_dir='folder -n2'")[0]?.tuned,
    ).toBe(false);
  });
  test("pytest ENV applies only to its command", () => {
    expect(
      collectTestWorkerCommands("PYTEST_ADDOPTS=-n2 pytest && pytest").map(
        (command) => command.tuned,
      ),
    ).toEqual([true, false]);
    expect(collectTestWorkerCommands("pytest", { PYTEST_ADDOPTS: "-n logical" })[0]?.tuned).toBe(
      true,
    );
    expect(
      collectTestWorkerCommands("export PYTEST_ADDOPTS=-n2\nunset PYTEST_ADDOPTS\npytest")[0]
        ?.tuned,
    ).toBe(false);
  });
  test("literal cd is reflected in config scope", () => {
    expect(collectTestWorkerCommands("cd packages/app && jest")[0]?.directory).toBe("packages/app");
  });
});
