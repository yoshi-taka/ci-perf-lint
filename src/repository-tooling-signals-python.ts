import type { RepositorySignals } from "./repository-signals-types.ts";
import { dependencySectionsOf } from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";
import type { AnyWorkflowDocument } from "./ci-types.ts";
import { collectCommandEntries } from "./rules/shared/any-step.ts";
import {
  extractPythonVersionLiteral,
  pythonVersionIsBelow311,
  requiresPythonConstrainsBelow311,
} from "./rules/shared/python-versions.ts";

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

const pythonVersionFileNames = [".python-version", "runtime.txt"] as const;

function lineOfIndex(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

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

async function collectPythonVersionOccurrences(
  context: RepositoryScanContext,
  signalFiles: { fileName: string; text: string }[],
): Promise<RepositorySignals["python"]["versionOccurrences"]> {
  const occurrences: RepositorySignals["python"]["versionOccurrences"] = [];

  const pushExact = (path: string, text: string, line: number): void => {
    const parsed = extractPythonVersionLiteral(text);
    if (parsed && pythonVersionIsBelow311(parsed.major, parsed.minor)) {
      occurrences.push({
        versionSpec: `${parsed.major}.${parsed.minor}`,
        major: parsed.major,
        minor: parsed.minor,
        path,
        line,
      });
    }
  };

  for (const { fileName, text } of signalFiles) {
    if (fileName === "pyproject.toml" || fileName === "setup.cfg") {
      const match = /(?:requires-python|python_requires)\s*=\s*["']?([^"'\n]+)["']?/i.exec(text);
      if (match?.[1] && requiresPythonConstrainsBelow311(match[1])) {
        occurrences.push({
          versionSpec: match[1].trim(),
          path: fileName,
          line: lineOfIndex(text, match.index),
        });
      }
    } else if (fileName === "tox.ini") {
      const match = /basepython\s*=\s*(?:python)?v?([0-9.]+)/i.exec(text);
      if (match?.[1]) {
        const parsed = extractPythonVersionLiteral(match[1]);
        if (parsed && pythonVersionIsBelow311(parsed.major, parsed.minor)) {
          occurrences.push({
            versionSpec: `${parsed.major}.${parsed.minor}`,
            major: parsed.major,
            minor: parsed.minor,
            path: fileName,
            line: lineOfIndex(text, match.index),
          });
        }
      }
    }
  }

  for (const fileName of pythonVersionFileNames) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (text) {
      pushExact(fileName, text, 1);
    }
  }

  return occurrences;
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

  const versionOccurrences = await collectPythonVersionOccurrences(context, signalFiles);

  return {
    usesBlack,
    usesIsort,
    usesRuff,
    usesTox,
    usesNox,
    versionOccurrences,
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
  workflows: readonly AnyWorkflowDocument[] = [],
): Promise<RepositorySignals["pdm"]> {
  let usesPdm =
    (await context.pathExists(context.resolve("pdm.lock"))) ||
    (await context.pathExists(context.resolve("pdm.toml"))) ||
    workflows.some((workflow) =>
      collectCommandEntries(workflow).some((entry) =>
        /(?:^|\s)pdm\s+(?:install|sync|lock|add|run|update)\b/.test(entry.text),
      ),
    );
  let usesUv = false;

  const signalFiles = await loadExistingTextFiles(context, pdmConfigFileNames);
  for (const { fileName, text: signalText } of signalFiles) {
    if (fileName === "pdm.toml") {
      usesUv ||= /^\s*use_uv\s*=\s*true\s*(?:#.*)?$/im.test(signalText.split(/^\s*\[/m)[0] ?? "");
    }
  }
  usesUv ||= workflows.some((workflow) =>
    collectCommandEntries(workflow).some((entry) =>
      /\bpdm\s+config\s+(?:--local\s+)?use_uv\s+true\b/.test(entry.text),
    ),
  );

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
