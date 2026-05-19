import type { RepositorySignals } from "./repository-signals-types.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

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

  const usesGradle = hasGradlew || hasBuildGradle || hasSettingsGradle;
  const usesMaven = hasPomXml || hasMvnw;

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
  };
}
