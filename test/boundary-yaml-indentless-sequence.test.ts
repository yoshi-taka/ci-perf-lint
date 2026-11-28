import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseCiYaml } from "../src/ci-yaml.ts";
import { parseDocument } from "../src/yaml.ts";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import type { CiKind } from "../src/ci-types.ts";

const documents: Record<CiKind, string> = {
  buildkite: [
    "steps:",
    "- label: ':go: first'",
    "  command: go test ./...",
    "  matrix:",
    "    setup:",
    "      variant: &linux_variants",
    "      - container",
    "      - default",
    "- label: ':go: second'",
    "  command: go vet ./...",
    "  matrix:",
    "    setup:",
    "      variant: *linux_variants",
  ].join("\n"),
  "github-actions": [
    "name: ci",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    strategy:",
    "      matrix:",
    "        os: &oses",
    "        - ubuntu-latest",
    "        - macos-latest",
    "    steps:",
    "    - run: echo ok",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    strategy:",
    "      matrix:",
    "        os: *oses",
    "    steps:",
    "    - run: echo ok",
  ].join("\n"),
  circleci: [
    "version: 2.1",
    "jobs:",
    "  build:",
    "    docker: &images",
    "    - image: cimg/node:20",
    "    - image: cimg/python:3",
    "    steps:",
    "    - checkout",
    "workflows:",
    "  build:",
    "    jobs:",
    "    - build:",
    "        docker: *images",
  ].join("\n"),
  "gitlab-ci": [
    "stages: &stages",
    "- build",
    "- test",
    "variables:",
    "  LIST: *stages",
    "build:",
    "  stage: build",
    "  script: echo ok",
  ].join("\n"),
};

describe("block sequences indented like their mapping key", () => {
  for (const kind of Object.keys(documents) as CiKind[]) {
    test(`${kind}: parses anchored indentless sequence and later alias`, () => {
      const source = documents[kind];
      const document = parseCiYaml(source, kind);
      expect(document.errors).toEqual([]);
      expect(document.toJS()).toEqual(
        referenceParse(source, { merge: kind !== "github-actions" }).toJS(),
      );
      expect(source).toContain("*");
    });
  }

  test("sequence item key with anchored sequence at the same indentation", () => {
    const source = "- key: &anchor\n  - one\n  - two\n- use: *anchor\n";
    const document = parseCiYaml(source, "buildkite");
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual([{ key: ["one", "two"] }, { use: ["one", "two"] }]);
  });

  test("sequence item key with tagged sequence at the same indentation", () => {
    const source = "- key: !seq\n  - one\n  - two\n";
    const document = parseCiYaml(source, "circleci");
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual([{ key: ["one", "two"] }]);
  });

  test("root mapping key with tagged sequence at the same indentation", () => {
    const source = "key: !seq\n- one\n- two\n";
    expect(parseDocument(source).errors).toEqual([]);
    expect(parseDocument(source).toJS()).toEqual({ key: ["one", "two"] });
  });

  test("Buildkite pipeline with indentless anchored sequence parses into matrix steps", () => {
    const source = documents.buildkite;
    const pipeline = parsePipeline("/repo/.buildkite/pipeline.yml", "/repo", source);
    expect(pipeline.steps).toHaveLength(2);
    const raw = pipeline.steps[0]?.node.toJSON() as { matrix?: { setup?: { variant?: string[] } } };
    expect(raw.matrix?.setup?.variant).toEqual(["container", "default"]);
  });
});
