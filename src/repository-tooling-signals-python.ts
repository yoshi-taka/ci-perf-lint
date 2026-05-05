import type { RepositorySignals } from "./repository-signals-types.ts";
import { dependencySectionsOf } from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

const pythonToolSignalFileNames = [
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "dev-requirements.txt",
  "setup.cfg",
  "tox.ini",
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
] as const;

const hatchConfigFileNames = ["pyproject.toml", "hatch.toml"] as const;

const pdmConfigFileNames = ["pyproject.toml", "pdm.toml"] as const;

const nativeHeavyNodePackages = [
  "sharp",
  "canvas",
  "sqlite3",
  "better-sqlite3",
  "esbuild",
] as const;

const nativeHeavyPythonPackages = ["cryptography", "lxml", "orjson"] as const;

async function loadExistingTextFiles(
  context: RepositoryScanContext,
  fileNames: readonly string[],
): Promise<{ fileName: string; text: string }[]> {
  const loads = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = context.resolve(fileName);
      if (!(await context.pathExists(filePath))) {
        return undefined;
      }

      const text = await context.readTextFileOrWarn(filePath);
      if (!text) {
        return undefined;
      }

      return { fileName, text };
    }),
  );

  return loads.filter((entry): entry is { fileName: string; text: string } => Boolean(entry));
}

export async function collectPythonSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["python"]> {
  let usesBlack = false;
  let usesIsort = false;
  let usesRuff = false;
  let usesTox = false;
  let usesNox = false;

  const signalFiles = await loadExistingTextFiles(context, pythonToolSignalFileNames);
  for (const { text: signalText } of signalFiles) {
    usesBlack ||= /\bblack\b|\[tool\.black\]/i.test(signalText);
    usesIsort ||= /\bisort\b|\[tool\.isort\]/i.test(signalText);
    usesRuff ||= /\bruff\b|\[tool\.ruff(?:\.[^\]]+)?\]/i.test(signalText);
    usesTox ||= /(?:^|\s)\[tox\]|\[tool\.tox\]|requires\s*=.*\btox\b|deps\s*=.*\btox\b/i.test(
      signalText,
    );
    usesNox ||= /\bnox\b/i.test(signalText);
  }

  if (!usesNox) {
    usesNox = await context.pathExists(context.resolve("noxfile.py")).catch(() => false);
  }

  return {
    usesBlack,
    usesIsort,
    usesRuff,
    usesTox,
    usesNox,
  };
}

export async function collectHatchSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["hatch"]> {
  let usesHatch = false;
  let usesUvInstaller = false;

  const signalFiles = await loadExistingTextFiles(context, hatchConfigFileNames);
  for (const { text: signalText } of signalFiles) {
    usesHatch ||= /\[tool\.hatch(?:\.[^\]]+)?\]|^\[env\]|^\[hatch\./im.test(signalText);
    if (usesHatch) {
      usesUvInstaller ||= /installer\s*=\s*["']uv["']/i.test(signalText);
    }
  }

  return { usesHatch, usesUvInstaller };
}

export async function collectPdmSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["pdm"]> {
  let usesPdm = false;
  let usesUv = false;

  const signalFiles = await loadExistingTextFiles(context, pdmConfigFileNames);
  for (const { text: signalText } of signalFiles) {
    usesPdm ||= /\[tool\.pdm\]|^\[pdm\]/im.test(signalText);
    if (usesPdm) {
      usesUv ||= /use_uv\s*=\s*true/i.test(signalText);
    }
  }

  return { usesPdm, usesUv };
}

export async function collectNativePackageSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["nativePackages"]> {
  const node = new Set<string>();
  const python = new Set<string>();

  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.value) {
    const packageJson = packageJsonEntry.value;
    for (const section of dependencySectionsOf(packageJson)) {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }

      for (const packageName of nativeHeavyNodePackages) {
        if (typeof (section as Record<string, unknown>)[packageName] === "string") {
          node.add(packageName);
        }
      }
    }
  }

  const signalFiles = await loadExistingTextFiles(context, pythonToolSignalFileNames);
  for (const { text: signalText } of signalFiles) {
    for (const packageName of nativeHeavyPythonPackages) {
      if (new RegExp(`\\b${packageName}\\b`, "i").test(signalText)) {
        python.add(packageName);
      }
    }
  }

  return {
    node: [...node].sort(),
    python: [...python].sort(),
  };
}
