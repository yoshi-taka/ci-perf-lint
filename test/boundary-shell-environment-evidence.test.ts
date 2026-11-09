import { expect, test } from "bun:test";
import { declaredShellEnvironmentNames } from "../src/rules/shared/shell-environment-evidence.ts";
import { downloadCommandUrls } from "../src/rules/shared/download-command-arguments.ts";

test.each([
  ["export HELM_VERSION=3.14", ["HELM_VERSION"]],
  ["HELM_VERSION=3.14 brew install helm", ["HELM_VERSION"]],
  ["echo HELM_VERSION=3.14", []],
  ["# HELM_VERSION=3.14", []],
  ['echo "HELM_VERSION=3.14" >> "$GITHUB_ENV"', ["HELM_VERSION"]],
  ['printf "HELM_VERSION=%s\\n" 3.14 >> "${GITHUB_ENV}"', ["HELM_VERSION"]],
  ['echo "HELM_VERSION=3.14" >> "$GITHUB_OUTPUT"', []],
  ["echo 'HELM_VERSION=3.14' >> '$GITHUB_ENV'", []],
  ['echo "HELM_VERSION=3.14" 2>> "$GITHUB_ENV"', []],
  ['echo "HELM_VERSION=3.14" 1>> "$GITHUB_ENV"', ["HELM_VERSION"]],
] as const)("environment declarations are not plain logs: %s", (text, expected) => {
  expect([...declaredShellEnvironmentNames(text)]).toEqual([...expected]);
});

test("download URLs exclude data/header/output options", () => {
  const url = "https://example.invalid/tool";
  expect(downloadCommandUrls(["curl", "--data", url, "https://example.invalid/api"])).toEqual([
    "https://example.invalid/api",
  ]);
  expect(downloadCommandUrls(["curl", "--header", url, "--url", url])).toEqual([url]);
  expect(downloadCommandUrls(["wget", "-O", url, "https://example.invalid/real"])).toEqual([
    "https://example.invalid/real",
  ]);
  expect(downloadCommandUrls(["curl", "--head", url])).toEqual([]);
  expect(downloadCommandUrls(["wget", "-c", url])).toEqual([url]);
  expect(downloadCommandUrls(["aria2c", "-c", url])).toEqual([url]);
});
