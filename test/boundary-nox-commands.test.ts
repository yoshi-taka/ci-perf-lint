import { describe, expect, test } from "bun:test";
import { collectNoxCommands, noxConfigHasBackendChoice } from "../src/rules/shared/nox-commands.ts";

describe("nox command boundaries", () => {
  test.each([
    ["nox -s tests", [true]],
    ["pip install nox && nox -s tests", [true]],
    ["uv pip install nox && nox -s tests", [true]],
    ["echo --uv && nox -s tests", [true]],
    ["nox --uv -s lint && nox -s tests", [false, true]],
    ["nox -s lint && nox --uv -s tests", [true, false]],
    ["nox -s tests # --uv", [true]],
    ['nox -k "tests --uv"', [true]],
    ["nox --report=reports/--uv.json -s tests", [true]],
    ["nox -- --uv", [true]],
    ["nox --uv -- --help", [false]],
    ["nox --default-venv-backend uv -s tests", [false]],
    ["nox --default-venv-backend=uv -s tests", [false]],
    ["nox -db uv -s tests", [false]],
    ["nox -fb uv -s tests", [false]],
    ["nox --force-venv-backend conda -s tests", [false]],
    ["nox --no-venv -s tests", [false]],
    ["nox --help", [false]],
    ["nox --list-sessions", [false]],
    ["nox --usage tests", [false]],
    ["python3.12 -m nox -s tests", [true]],
    ["python3 -I -m nox --uv -s tests", [false]],
    ["/opt/venv/bin/nox -s tests", [true]],
    ["uv run nox -s tests", [true]],
    ["uvx nox --uv -s tests", [false]],
    ["NOX_DEFAULT_VENV_BACKEND=uv nox -s tests", [false]],
    ["env NOX_DEFAULT_VENV_BACKEND=conda nox -s tests", [false]],
    ["nox -s $SESSION", [true]],
    ["nox $OPTIONS", [false]],
    ["echo nox -s tests", []],
    ["echo 'nox -s tests'", []],
    ["pip install nox", []],
    ["python3 -m other nox", []],
    ["cat <<EOF\nnox -s tests\nEOF", []],
  ] as const)("%s", (text, expected) => {
    expect(collectNoxCommands(text).map((command) => command.needsUv)).toEqual([...expected]);
  });
  test("custom noxfile stays associated with its invocation", () => {
    expect(collectNoxCommands("nox -f custom.py -s tests")).toEqual([
      { needsUv: true, noxfile: "custom.py" },
    ]);
  });
  test("workflow env is honored without leaking command-local settings", () => {
    expect(collectNoxCommands("nox -s tests", { NOX_DEFAULT_VENV_BACKEND: "uv" })[0]?.needsUv).toBe(
      false,
    );
    expect(
      collectNoxCommands("NOX_DEFAULT_VENV_BACKEND=uv nox -s lint && nox -s tests").map(
        (command) => command.needsUv,
      ),
    ).toEqual([false, true]);
  });
});

describe("literal noxfile backend configuration", () => {
  test.each([
    ["nox.options.uv = True", true],
    ["nox.options.uv = False", false],
    ["nox.options.uv = True\nnox.options.uv = False", false],
    ["nox.options.uv = False\nnox.options.uv = True", true],
    ['nox.options.default_venv_backend = "uv"', true],
    ["nox.options.force_venv_backend = 'uv|virtualenv'", true],
    ['nox.options.default_venv_backend = "conda"', true],
    [
      'nox.options.default_venv_backend = "uv"\nnox.options.default_venv_backend = choose_backend()',
      false,
    ],
    ["# nox.options.uv = True", false],
    ["uv = True", false],
    ['example = "nox.options.uv = True"', false],
    ['"""\nnox.options.uv = True\n"""', false],
    ['example = "first\\\nnox.options.uv = True"', false],
    ["if enabled:\n    nox.options.uv = True", false],
    ["nox.options.uv = True # opt in", true],
  ] as const)("%s", (source, expected) => {
    expect(noxConfigHasBackendChoice(source)).toBe(expected);
  });
});
