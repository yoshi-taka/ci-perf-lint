import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  motoVersionIsBelow5121,
  preferMoto5121Meta as meta,
  preferMoto5121Why,
  preferMoto5121Suggestion,
  preferMoto5121MeasurementHint,
} from "../rules/shared/moto-versions.ts";

interface MotoPin {
  version: string;
  line: number;
}

function lockfilePins(text: string): MotoPin[] {
  const pins: MotoPin[] = [];
  const lines = text.split("\n");
  let name: string | undefined;
  let version: MotoPin | undefined;
  const finish = (): void => {
    if (name === "moto" && version) {
      pins.push(version);
    }
  };
  for (const [index, line] of lines.entries()) {
    if (/^\[\[package\]\]\s*(?:#.*)?$/.test(line.trim())) {
      finish();
      name = undefined;
      version = undefined;
    } else if (/^\[/.test(line.trim())) {
      finish();
      name = undefined;
      version = undefined;
    } else {
      const nameMatch = /^name\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/.exec(line.trim());
      if (nameMatch) {
        name = nameMatch[1];
      }
      const versionMatch = /^version\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/.exec(line.trim());
      if (versionMatch) {
        version = { version: versionMatch[1]!, line: index + 1 };
      }
    }
  }
  finish();
  return pins;
}

export async function collectPreferMoto5121Diagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const build = (fileName: string, pin: MotoPin): Diagnostic[] => [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: fileName, line: pin.line, column: 1 },
      message: `${fileName} pins Moto ${pin.version}, below the Moto 5.1.21 performance milestone.`,
      why: preferMoto5121Why,
      suggestion: preferMoto5121Suggestion,
      measurementHint: preferMoto5121MeasurementHint,
      aiHandoff: `Review ${fileName}:${pin.line} and upgrade Moto ${pin.version} to 5.1.21 or later. Update the dependency declaration and regenerate the lockfile with the existing package manager. Review mock_aws, server arguments, IAM policy loading, supported Python versions, and test-state isolation without weakening assertions.`,
      score: 50,
    }),
  ];
  // Resolved lockfile evidence takes precedence over declarations. Unknown or
  // mixed current/old resolutions are not sufficient evidence for an old pin.
  for (const fileName of ["uv.lock", "poetry.lock"]) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      return [];
    }
    const pins = lockfilePins(text);
    return pins.length > 0 && pins.every((pin) => motoVersionIsBelow5121(pin.version))
      ? build(fileName, pins[0]!)
      : [];
  }
  for (const fileName of ["requirements.txt", "requirements-dev.txt", "dev-requirements.txt"]) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }
    for (const [index, line] of text.split("\n").entries()) {
      const match =
        /^\s*moto(?:\[[\w, .-]+\])?\s*==\s*(\d+\.\d+\.\d+)\s*(?:;[^#]*)?(?:#.*)?$/i.exec(line);
      if (match && motoVersionIsBelow5121(match[1]!)) {
        return build(fileName, { version: match[1]!, line: index + 1 });
      }
    }
  }
  return [];
}
