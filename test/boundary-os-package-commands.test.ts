import { expect, test } from "bun:test";
import { collectAptInstallCommands } from "../src/rules/shared/os-package-commands.ts";

test.each([
  ["sudo apt-get install -y clang ninja-build", [["clang", "ninja-build"]]],
  ["sudo apt-get -y install jq", [["jq"]]],
  ["apt install -o 'DPkg::Options::=--force-confnew' jq=1.7", [["jq=1.7"]]],
  ["apt install jq; echo clang ninja-build", [["jq"]]],
  ["apt install --simulate clang", []],
  ["apt install -o clang", []],
  ["echo 'apt-get install clang'", []],
  ["# apt-get install clang", []],
  ["apt-get install $PACKAGES", []],
] as const)("APT arguments stay in their invocation: %s", (text, expected) => {
  expect(collectAptInstallCommands(text).map((command) => command.packages)).toEqual(
    expected.map((packages) => [...packages]),
  );
});
