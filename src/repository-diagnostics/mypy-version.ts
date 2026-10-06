import type { RepositoryScanContext } from "../repository-scan-context.ts";

const mypyDependencyFileNames = [
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "dev-requirements.txt",
  "setup.cfg",
  "setup.py",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
] as const;

export interface DetectedMypyVersion {
  fileName: string;
  line: number;
  version: string;
}

function extractMypyVersion(line: string): string | undefined {
  const match = line.match(/\bmypy\s*(?:[<>=!~]=?|\^)?\s*["']?(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1];
}

function findLineIndex(text: string, predicate: (line: string) => boolean): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (predicate(lines[i]!)) {
      return i;
    }
  }
  return -1;
}

export async function detectInstalledMypyVersion(
  context: RepositoryScanContext,
): Promise<DetectedMypyVersion | undefined> {
  for (const fileName of mypyDependencyFileNames) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }

    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }

    let detectedLine = -1;
    let detectedVersion: string | undefined;

    if (fileName === "poetry.lock") {
      const lines = text.split("\n");
      let inMypyBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === "[[package]]") {
          inMypyBlock = false;
          continue;
        }
        if (/^name\s*=\s*["']mypy["']\s*$/.test(line.trim())) {
          inMypyBlock = true;
          continue;
        }
        if (inMypyBlock) {
          const versionMatch = /^version\s*=\s*["'](\d+\.\d+(?:\.\d+)?)/.exec(line.trim());
          if (versionMatch) {
            detectedVersion = versionMatch[1];
            detectedLine = i;
            break;
          }
          if (/^name\s*=/.test(line.trim())) {
            inMypyBlock = false;
          }
        }
      }
    } else {
      detectedLine = findLineIndex(text, (line) => {
        const version = extractMypyVersion(line);
        if (version) {
          detectedVersion = version;
          return true;
        }
        return false;
      });
    }

    if (detectedLine >= 0 && detectedVersion) {
      return { fileName, line: detectedLine, version: detectedVersion };
    }
  }

  return undefined;
}
