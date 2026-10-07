import type { RepositorySignals } from "./repository-signals-types.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";
import path from "node:path";
import type { AnyWorkflowDocument } from "./ci-types.ts";
import { collectCommandEntries } from "./rules/shared/any-step.ts";
import { shellCommandSegments, staticShellWords } from "./rules/shared/command-patterns.ts";

async function hasSrcSubdir(context: RepositoryScanContext, subdir: string): Promise<boolean> {
  try {
    const [mainExists, testExists] = await Promise.all([
      context.pathExists(context.resolve("src", "main", subdir)),
      context.pathExists(context.resolve("src", "test", subdir)),
    ]);
    return mainExists || testExists;
  } catch {
    return false;
  }
}

export async function collectJvmSignals(
  context: RepositoryScanContext,
  workflows: readonly AnyWorkflowDocument[] = [],
): Promise<RepositorySignals["jvm"]> {
  const rootEntries = await context.readDirectoryEntries(context.repoRoot);
  const rootNames = new Set(rootEntries.map((e) => e.name));

  const hasEntry = (name: string): boolean => rootNames.has(name);
  const isDir = (name: string): boolean => {
    const entry = rootEntries.find((e) => e.name === name);
    return entry?.isDirectory() ?? false;
  };

  const isSrcDir = isDir("src");

  const [hasJavaSrc, hasKotlinSrc, hasScalaSrc, hasGroovySrc] = await Promise.all([
    isSrcDir ? hasSrcSubdir(context, "java") : false,
    isSrcDir ? hasSrcSubdir(context, "kotlin") : false,
    isSrcDir ? hasSrcSubdir(context, "scala") : false,
    isSrcDir ? hasSrcSubdir(context, "groovy") : false,
  ]);

  const usesJava = hasJavaSrc;
  let usesKotlin = hasKotlinSrc;
  let usesScala = hasScalaSrc || hasEntry("build.sbt");
  const usesGroovy = hasGroovySrc;

  const hasPomXml = hasEntry("pom.xml");
  const hasMvnw = hasEntry("mvnw") || hasEntry("mvnw.cmd");
  const hasGradlew = hasEntry("gradlew") || hasEntry("gradlew.bat");
  const hasBuildGradle = hasEntry("build.gradle") || hasEntry("build.gradle.kts");
  const hasSettingsGradle = hasEntry("settings.gradle") || hasEntry("settings.gradle.kts");

  let usesGradle = hasGradlew || hasBuildGradle || hasSettingsGradle;
  let usesMaven = hasPomXml || hasMvnw;
  const buildRoots = new Set<string>();
  if (usesGradle || usesMaven) {
    buildRoots.add(".");
  }
  for (const workflow of workflows) {
    for (const entry of collectCommandEntries(workflow)) {
      let cwd = entry.workingDirectory ?? ".";
      for (const segment of shellCommandSegments(entry.text)) {
        const words = staticShellWords(segment);
        if (!words) {
          continue;
        }
        if (words[0] === "cd" && words[1]) {
          cwd = path.posix.join(cwd, words[1]);
          continue;
        }
        const tool = words[0] ?? "";
        if (!/^(?:.*\/)?(?:gradlew?|mvnw?)$/.test(tool)) {
          continue;
        }
        const relativeRoot = path.posix.normalize(path.posix.join(cwd, path.posix.dirname(tool)));
        if (
          path.isAbsolute(relativeRoot) ||
          relativeRoot === ".." ||
          relativeRoot.startsWith("../")
        ) {
          continue;
        }
        const names = tool.includes("gradle")
          ? [
              "build.gradle",
              "build.gradle.kts",
              "settings.gradle",
              "settings.gradle.kts",
              "gradlew",
            ]
          : ["pom.xml", "mvnw"];
        const present = (
          await Promise.all(
            names.map((name) => context.pathExists(context.resolve(relativeRoot, name))),
          )
        ).some(Boolean);
        if (!present) {
          continue;
        }
        buildRoots.add(relativeRoot);
        usesGradle ||= tool.includes("gradle");
        usesMaven ||= tool.includes("mvn");
      }
    }
  }

  let usesSpringBoot = false;

  if (usesMaven && hasPomXml) {
    const pomText = await context.readTextFileOrWarn(context.resolve("pom.xml"));
    if (pomText && /spring-boot/i.test(pomText)) {
      usesSpringBoot = true;
    }
  }

  if (usesGradle) {
    const gradleFiles = ["build.gradle", "build.gradle.kts"];
    const springBootInGradle = (
      await Promise.all(
        gradleFiles
          .filter((f) => hasEntry(f))
          .map((f) =>
            context
              .readTextFileOrWarn(context.resolve(f))
              .then((text) => text && /spring-boot/i.test(text)),
          ),
      )
    ).some(Boolean);
    if (springBootInGradle) {
      usesSpringBoot = true;
    }

    if (hasEntry("build.gradle.kts")) {
      const ktsText = await context.readTextFileOrWarn(context.resolve("build.gradle.kts"));
      if (ktsText && /\bkotlin\s*\(/i.test(ktsText)) {
        usesKotlin = true;
      }
    }
  }

  if (usesMaven && hasPomXml && !usesKotlin) {
    const pomText = await context.readTextFileOrWarn(context.resolve("pom.xml"));
    if (pomText && /kotlin/i.test(pomText)) {
      usesKotlin = true;
    }
  }

  const usesJvm = usesJava || usesKotlin || usesScala || usesGroovy || usesGradle || usesMaven;

  return {
    usesJvm,
    usesJava,
    usesKotlin,
    usesScala,
    usesGroovy,
    usesSpringBoot,
    usesMaven,
    usesGradle,
    buildRoots: [...buildRoots].sort(),
  };
}
