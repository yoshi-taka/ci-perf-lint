import { describe, expect, test } from "bun:test";
import {
  collectGradleCommands,
  gradleParallelProperty,
} from "../src/rules/shared/gradle-commands.ts";

describe("Gradle lifecycle and parallel option boundaries", () => {
  test.each([
    ["./gradlew build", [false]],
    ["gradle test", [false]],
    ["./gradlew :lib:test", [false]],
    ["./gradlew assembleDebug", [false]],
    ["./gradlew publishToMavenLocal", [false]],
    ["./gradlew build && echo --parallel", [false]],
    ['gradle test --tests "slow --parallel"', [false]],
    ["gradle properties -Pdescription=build", []],
    ["gradle help --task build", []],
    ["gradle tasks --group build", []],
    ["gradle run --args build", []],
    ["gradle build --parallel", [true]],
    ["gradle --parallel build", [true]],
    ["gradle build --no-parallel", [true]],
    ["gradle --parallel build && gradle test", [true, false]],
    ["gradle build && gradle --parallel test", [false, true]],
    ["gradle -- build --parallel", [false]],
    ["gradle --parallel -- build", [true]],
    ["gradle build -Dorg.gradle.parallel=true", [true]],
    ["gradle build --system-prop org.gradle.parallel=false", [true]],
    ["gradle build -Porg.gradle.parallel=true", [false]],
    ['gradle build -Dmessage="value --parallel"', [false]],
    ["gradle build # --parallel", [false]],
    ["gradle build --help", []],
    ["gradle build --dry-run", []],
    ["gradle --show-version build", [false]],
    ["gradle --version", []],
    ["gradle build --init-script scripts/--parallel.gradle", []],
    ["echo './gradlew build'", []],
    ["pip install gradle", []],
    ["cat <<EOF\ngradle build\nEOF", []],
    ["gradle $ARGS", []],
  ] as const)("%s", (text, expected) => {
    expect(
      collectGradleCommands(text)
        .filter((command) => command.lifecycle)
        .map((command) => command.parallelConfigured),
    ).toEqual([...expected]);
  });
  test.each([
    ["./gradlew -p java build", "java"],
    ["./gradlew build --project-dir=java", "java"],
    ["gradle -pjava test", "java"],
    ["cd java && ../gradlew build", "java"],
    ["cd -- java && ../gradlew build", "java"],
    ["./java/gradlew build", "."],
    ["gradle -p ../outside build", undefined],
    ["gradle -p $PROJECT build", undefined],
  ] as const)("project location: %s", (text, expected) => {
    expect(collectGradleCommands(text)[0]?.directory).toBe(expected);
  });
  test("known JVM properties apply only to their invocation", () => {
    expect(
      collectGradleCommands(
        "GRADLE_OPTS=-Dorg.gradle.parallel=true gradle build && gradle test",
      ).map((command) => command.parallelConfigured),
    ).toEqual([true, false]);
    expect(
      collectGradleCommands("gradle build", { JAVA_OPTS: "-Dorg.gradle.parallel=false" })[0]
        ?.parallelConfigured,
    ).toBe(true);
    expect(
      collectGradleCommands("gradle build", { GRADLE_OPTS: '-Dmessage="value --parallel"' })[0]
        ?.parallelConfigured,
    ).toBe(false);
  });
  test("user-home sources preserve their precedence", () => {
    const command = collectGradleCommands("gradle build -g ci-home -Dgradle.user.home=other-home", {
      GRADLE_USER_HOME: "env-home",
    })[0];
    expect(command?.userHome).toBe("ci-home");
    expect(
      collectGradleCommands("gradle build", { GRADLE_OPTS: "-Dgradle.user.home=vm-home" })[0]
        ?.userHome,
    ).toBe("vm-home");
  });
  test("unknown user homes do not collide with literal directory names", () => {
    expect(collectGradleCommands("gradle build -g unknown")[0]?.userHome).toBe("unknown");
    expect(
      collectGradleCommands("gradle build -g /external", { GRADLE_USER_HOME: "env-home" })[0]
        ?.userHome,
    ).toBeNull();
  });
});

describe("Gradle parallel properties", () => {
  test.each([
    ["org.gradle.parallel=true", "enabled"],
    ["org.gradle.parallel=false", "disabled"],
    ["org.gradle.parallel=true\norg.gradle.parallel=false", "disabled"],
    ["org.gradle.parallel=false\norg.gradle.parallel=true", "enabled"],
    ["org.gradle.parallel : true", "enabled"],
    ["org.gradle.parallel true", "enabled"],
    ["org.gradle.parallel=tr\\\n  ue", "enabled"],
    ["systemProp.org.gradle.parallel=true", "enabled"],
    ["org.gradle.parallel=$SETTING", "unknown"],
    ["org.gradle.parallel=", "unknown"],
    ["# org.gradle.parallel=true", "absent"],
    ["! org.gradle.parallel=true", "absent"],
    ["message=org.gradle.parallel=true", "absent"],
  ] as const)("%s", (text, expected) => {
    expect(gradleParallelProperty(text)).toBe(expected);
  });
});
