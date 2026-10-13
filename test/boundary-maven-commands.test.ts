import { expect, test } from "bun:test";
import {
  collectMavenCommands,
  mavenConfiguresThreads,
} from "../src/rules/shared/maven-commands.ts";

test.each([
  ["mvn verify", [false]],
  ["./mvnw install", [false]],
  ["mvnw.cmd test", [false]],
  ["/opt/maven/bin/mvn package", [false]],
  ["mvn verify && echo -T2", [false]],
  ['mvn verify -Dmessage="value -T2"', [false]],
  ['mvn verify --settings "path --threads=2"', [false]],
  ["mvn verify -Pparallel-T2", [false]],
  ["mvn verify # --threads=2", [false]],
  ["mvn -T2 verify", [true]],
  ["mvn -T=2 verify", [true]],
  ["mvn -T 1C verify", [true]],
  ["mvn --threads=2 verify", [true]],
  ["mvn --threads 0.5C verify", [true]],
  ["mvn -T.5C verify", [true]],
  ["mvn -T2 verify && mvn test", [true, false]],
  ["mvn verify && mvn -T2 test", [false, true]],
  ["mvn --show-version verify", [false]],
  ["mvn -V verify", [false]],
  ["mvn -- verify --threads=2", [false]],
  ["mvn help:evaluate -Dexpression=project.verify", []],
  ["mvn help:evaluate --define verify", []],
  ["mvn help:evaluate -P verify", []],
  ["mvn help:evaluate --file package", []],
  ["mvn help:evaluate --settings test", []],
  ["mvn --version verify", []],
  ["mvn verify --help", []],
  ["echo 'mvn verify'", []],
  ["cat <<EOF\nmvn verify\nEOF", []],
  ["mvn $GOALS", []],
  ["echo $(mvn verify) $(mvn test)", []],
  ["mvn verify --threads", []],
  ["mvn verify -Tbad", []],
] as const)("Maven lifecycle and thread option boundaries: %s", (text, expected) => {
  expect(
    collectMavenCommands(text)
      .filter((command) => command.lifecycle && !command.opaque && !command.inactive)
      .map((command) => command.parallelConfigured),
  ).toEqual([...expected]);
});

test.each([
  ["--threads\n1C\n", true],
  ["-T1C\n", true],
  ["# threads\n--threads=2\n", true],
  ["--threads=0.5C", true],
  ["-T=2", true],
  ["# -T2", false],
  ['-Dmessage="value -T2"', false],
  ['--settings "directory --threads=2"', false],
  ["-Dexample=-T2", false],
  ["-Pparallel-T2", false],
  ["-- -T2", false],
  ["--threads", undefined],
  ["-T$WORKERS", undefined],
] as const)("Maven config option ownership: %s", (text, expected) => {
  expect(mavenConfiguresThreads(text)).toBe(expected);
});

test("MAVEN_ARGS belongs only to its invocation", () => {
  expect(
    collectMavenCommands("MAVEN_ARGS=-T2 mvn verify && mvn test").map(
      (command) => command.parallelConfigured,
    ),
  ).toEqual([true, false]);
  expect(
    collectMavenCommands("mvn verify", { MAVEN_ARGS: "--threads 1C" })[0]?.parallelConfigured,
  ).toBe(true);
  expect(collectMavenCommands("mvn verify", { MAVEN_OPTS: "-T2" })[0]?.parallelConfigured).toBe(
    false,
  );
  expect(collectMavenCommands("mvn", { MAVEN_ARGS: "verify" })[0]?.lifecycle).toBe(true);
  expect(collectMavenCommands("mvn verify", { MAVEN_ARGS: "$OPTIONS" })).toEqual([]);
});
