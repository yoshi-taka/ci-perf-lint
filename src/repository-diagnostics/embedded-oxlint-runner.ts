import { spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisWarning } from "../types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { fontAwesomeIconPackRoots } from "./direct-import-roots.ts";

const OXLINE_RE = /^(.+?):(\d+):(\d+):\s*(.+?)\s*\[(\w+)\/([^\]]+)\]/;

export interface OxlintDiagnostic {
  filename: string;
  line: number;
  column: number;
  message: string;
  severity: string;
  code: string;
}

export type EmbeddedOxlintScanKind = "import" | "non-import";

const embeddedOxlintConfigPathPromises = new Map<EmbeddedOxlintScanKind, Promise<string>>();
const embeddedOxlintIgnoredDirectories = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);
const embeddedOxlintDefaultIgnorePatterns = [...embeddedOxlintIgnoredDirectories].map(
  (dir) => `**/${dir}/**`,
);
const MAX_STDERR_BUFFER_SIZE = 1024 * 1024;
const EMBEDDED_OXLINT_TIMEOUT_MS = 5_000;

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

function spawnProcess(
  cmd: string[],
  cwd: string,
): {
  stdout: Promise<string>;
  stderr: Promise<string>;
  exited: Promise<number>;
  kill: (signal?: number) => void;
} {
  if (typeof Bun !== "undefined") {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    return {
      stdout: new Response(proc.stdout).text(),
      stderr: new Response(proc.stderr).text(),
      exited: proc.exited,
      kill: (signal) => { proc.kill(signal); },
    };
  }

  const proc = spawn(cmd[0]!, cmd.slice(1), {
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stderrSize = 0;
  proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  proc.stderr.on("data", (chunk: Buffer) => {
    if (stderrSize < MAX_STDERR_BUFFER_SIZE) {
      stderrChunks.push(chunk);
      stderrSize += chunk.length;
    }
  });
  return {
    stdout: new Promise<string>((resolve) => {
      proc.on("close", () => resolve(Buffer.concat(stdoutChunks).toString()));
    }),
    stderr: new Promise<string>((resolve) => {
      proc.on("close", () => resolve(Buffer.concat(stderrChunks).toString()));
    }),
    exited: new Promise<number>((resolve) => {
      proc.on("close", (code) => resolve(code ?? 1));
    }),
    kill: (signal) => { proc.kill(signal); },
  };
}

function embeddedOxlintConfigContents(kind: EmbeddedOxlintScanKind): string {
  const importRules: Record<string, unknown> = {
    "no-restricted-imports": [
      "warn",
      {
        paths: [
          {
            name: "@material-ui/core",
            message: "Prefer direct Material UI v4 component imports for CI tooling cost.",
          },
          {
            name: "@material-ui/icons",
            message: "Prefer direct Material UI v4 icon imports for CI tooling cost.",
          },
          { name: "mui-core", message: "Prefer direct mui-core imports for CI tooling cost." },
          "lucide-react/dynamic",
          {
            name: "lucide-angular",
            importNames: ["icons"],
            message: "Avoid lucide-angular icons registry imports for CI tooling cost.",
          },
          { name: "date-fns", message: "Prefer direct date-fns imports for CI tooling cost." },
          {
            name: "lodash-es",
            message: "Prefer direct lodash-es imports for CI tooling cost.",
          },
          { name: "ramda", message: "Prefer direct ramda imports for CI tooling cost." },
          {
            name: "antd",
            message: "Prefer direct antd component imports for CI tooling cost.",
          },
          {
            name: "@ant-design/icons",
            message: "Prefer direct Ant Design icon imports for CI tooling cost.",
          },
          {
            name: "@tabler/icons-react",
            message: "Prefer direct Tabler icon imports for CI tooling cost.",
          },
          {
            name: "react-bootstrap",
            message: "Prefer direct react-bootstrap component imports for CI tooling cost.",
          },
          {
            name: "@headlessui/react",
            message: "Prefer direct Headless UI imports for CI tooling cost.",
          },
          {
            name: "@headlessui-float/react",
            message: "Prefer direct Headless UI Float imports for CI tooling cost.",
          },
          {
            name: "@visx/visx",
            message: "Prefer direct visx package imports for CI tooling cost.",
          },
          {
            name: "@tremor/react",
            message: "Prefer direct Tremor component imports for CI tooling cost.",
          },
          { name: "rxjs", message: "Prefer direct RxJS imports for CI tooling cost." },
          { name: "recharts", message: "Prefer direct Recharts imports for CI tooling cost." },
          {
            name: "react-use",
            message: "Prefer direct react-use hook imports for CI tooling cost.",
          },
          { name: "effect", message: "Prefer direct Effect imports for CI tooling cost." },
          {
            name: "@angular/material",
            message: "Prefer Angular Material secondary entry-point imports for CI tooling cost.",
          },
          ...fontAwesomeIconPackRoots.map((dependencyName) => ({
            name: dependencyName,
            message: "Prefer direct Font Awesome icon imports for CI tooling cost.",
          })),
        ],
        patterns: [
          { regex: "^@mui/[^/]+$" },
          {
            group: ["**/*.svg"],
            importNames: ["ReactComponent"],
            message: "Import SVG files as URL/string assets instead of React components.",
          },
          {
            group: ["**/*.svg?react", "**/*.svg?vue", "**/*.svg?component"],
            message: "Import SVG files as URL/string assets instead of framework components.",
          },
          { regex: "^@heroicons/(?:react|vue|svelte)/(?:16|20|24)/(?:solid|outline)$" },
          {
            regex: "^react-icons/[^/]+$",
            message: "Prefer direct react-icons icon imports for CI tooling cost.",
          },
          {
            regex: "^@effect/[^/]+$",
            message: "Prefer direct @effect package imports for CI tooling cost.",
          },
        ],
      },
    ],
    "import/extensions": [
      "warn",
      "always",
      {
        ignorePackages: true,
        checkTypeImports: false,
      },
    ],
  };
  const nonImportRules: Record<string, unknown> = {
    "jest/no-large-snapshots": ["warn", { maxSize: 300, inlineMaxSize: 50 }],
    "oxc/no-barrel-file": "warn",
  };

  return JSON.stringify({
    rules: kind === "import" ? importRules : nonImportRules,
  });
}

function embeddedOxlintLabel(kind: EmbeddedOxlintScanKind): string {
  return kind === "import" ? "embedded-oxlint-import" : "embedded-oxlint-non-import";
}

function bundledOxlintPath(): string {
  const binaryName = process.platform === "win32" ? "oxlint.exe" : "oxlint";
  let dir = import.meta.dir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.resolve(dir, "node_modules", ".bin", binaryName);
    try {
      require("node:fs").accessSync(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return path.resolve(import.meta.dir, "..", "..", "node_modules", ".bin", binaryName);
}

function parseOxlintLine(line: string): OxlintDiagnostic | undefined {
  const match = OXLINE_RE.exec(line);
  if (!match) { return undefined; }
  return {
    filename: match[1]!,
    line: Number(match[2]!),
    column: Number(match[3]!),
    message: match[4]!,
    severity: match[5]!,
    code: match[6]!,
  };
}

async function writeEmbeddedOxlintConfig(kind: EmbeddedOxlintScanKind): Promise<string> {
  const cached = embeddedOxlintConfigPathPromises.get(kind);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const configDir = path.join(os.tmpdir(), "actions-performance-lint");
    const configPath = path.join(configDir, `embedded-oxlint-${kind}.json`);
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, embeddedOxlintConfigContents(kind));
    return configPath;
  })().catch((error) => {
    embeddedOxlintConfigPathPromises.delete(kind);
    throw error;
  });

  embeddedOxlintConfigPathPromises.set(kind, promise);
  return promise;
}

export async function cleanupEmbeddedOxlintTempConfigFiles(): Promise<void> {
  const paths = [...embeddedOxlintConfigPathPromises.values()];
  embeddedOxlintConfigPathPromises.clear();
  for (const pathPromise of paths) {
    try {
      const configPath = await pathPromise;
      await unlink(configPath).catch(() => {});
    } catch {
      // ignore errors during cleanup
    }
  }
}

export async function runEmbeddedOxlint(
  repoRoot: string,
  kind: EmbeddedOxlintScanKind,
  warnings?: AnalysisWarning[],
): Promise<OxlintDiagnostic[] | undefined> {
  try {
    const startedAt = performance.now();
    const localWarnings: AnalysisWarning[] = [];
    const context = new RepositoryScanContext(repoRoot, localWarnings);
    const source = embeddedOxlintLabel(kind);
    const oxlintPath = bundledOxlintPath();
    if (!(await context.pathExists(oxlintPath))) {
      context.warn(
        source,
        `Oxlint binary not found at ${oxlintPath}. Skipping oxlint-based diagnostics.`,
      );
      warnings?.push(...localWarnings);
      return undefined;
    }

    const configPath = await writeEmbeddedOxlintConfig(kind);
    const spawnStartedAt = performance.now();
    const ignorePatternFlags = embeddedOxlintDefaultIgnorePatterns.flatMap((pattern) => [
      "--ignore-pattern",
      pattern,
    ]);
    const cmd =
      kind === "import"
        ? [
            oxlintPath,
            "--disable-typescript-plugin",
            "--disable-unicorn-plugin",
            "--disable-oxc-plugin",
            "--import-plugin",
            "-D",
            "no-restricted-imports",
            "-D",
            "import/extensions",
            "-c",
            configPath,
            "-f",
            "unix",
            "--no-error-on-unmatched-pattern",
            "--disable-nested-config",
            ...ignorePatternFlags,
            ".",
          ]
        : [
            oxlintPath,
            "--disable-typescript-plugin",
            "--disable-unicorn-plugin",
            "--jest-plugin",
            "-A",
            "all",
            "-D",
            "jest/no-large-snapshots",
            "-D",
            "oxc/no-barrel-file",
            "-c",
            configPath,
            "-f",
            "unix",
            "--no-error-on-unmatched-pattern",
            "--disable-nested-config",
            ...ignorePatternFlags,
            ".",
          ];
    const { stdout, stderr, exited, kill } = spawnProcess(cmd, repoRoot);
    const timeoutHandle = setTimeout(() => {
      kill(9);
    }, EMBEDDED_OXLINT_TIMEOUT_MS);

    const FORCE_RESOLVE_AFTER_KILL_MS = 500;
    const timeoutPromise = new Promise<[string, string, number]>((resolve) => {
      setTimeout(
        () => resolve(["", "", -1]),
        EMBEDDED_OXLINT_TIMEOUT_MS + FORCE_RESOLVE_AFTER_KILL_MS,
      );
    });
    const result = await Promise.race([
      Promise.all([stdout, stderr, exited]),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle);

    const [stdoutText, stderrText, exitCode] = result;

    if (exitCode === -1) {
      process.stderr.write(
        `[${source}] Oxlint scan timed out after ${EMBEDDED_OXLINT_TIMEOUT_MS}ms. Barrel file detection, import restriction, and snapshot diagnostics were skipped for ${repoRoot}.\n`,
      );
      return [];
    }

    if (stderrText.trim().length > 0) {
      context.warn(
        source,
        `Embedded Oxlint stderr output while scanning ${repoRoot}: ${stderrText.slice(0, 500)}`,
      );
    }

    const diagnostics: OxlintDiagnostic[] = [];
    for (const line of stdoutText.split("\n")) {
      if (!line) { continue; }
      const parsed = parseOxlintLine(line);
      if (parsed) {
        diagnostics.push(parsed);
      }
    }

    if (exitCode !== 0 && diagnostics.length === 0) {
      context.warn(
        source,
        `Embedded Oxlint exited with code ${exitCode} and produced no output while scanning ${repoRoot}.`,
      );
      warnings?.push(...localWarnings);
      return [];
    }

    const spawnElapsed = performance.now() - spawnStartedAt;

    if (timingsEnabled()) {
      process.stderr.write(
        `[timing] ${source} spawn=${spawnElapsed.toFixed(1)}ms diagnostics=${diagnostics.length} total=${(performance.now() - startedAt).toFixed(1)}ms\n`,
      );
    }
    warnings?.push(...localWarnings);
    return diagnostics;
  } catch (error) {
    const localWarnings: AnalysisWarning[] = [];
    const context = new RepositoryScanContext(repoRoot, localWarnings);
    context.warn(
      embeddedOxlintLabel(kind),
      `Embedded Oxlint scan failed for ${repoRoot}: ${error instanceof Error ? error.message : String(error)}`,
    );
    warnings?.push(...localWarnings);
    return undefined;
  }
}
