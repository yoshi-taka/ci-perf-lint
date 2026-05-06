import { spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
const EMBEDDED_OXLINT_TIMEOUT_MS = 5_000;
const MAX_STDOUT_BUFFER_SIZE = 2 * 1024 * 1024;
const MAX_STDERR_BUFFER_SIZE = 1024 * 1024;

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

type SpawnedProcess = {
  stdout: Promise<string>;
  stderr: Promise<string>;
  exited: Promise<number>;
};

function spawnOxlintProcess(
  cmd: string[],
  cwd: string,
  useNodeSpawn?: boolean,
  timeoutMs?: number,
): SpawnedProcess {
  const effectiveTimeout = timeoutMs ?? EMBEDDED_OXLINT_TIMEOUT_MS;
  if (!useNodeSpawn && typeof Bun !== "undefined") {
    const proc = Bun.spawn(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: effectiveTimeout,
    });
    return {
      stdout: new Response(proc.stdout).text(),
      stderr: new Response(proc.stderr).text(),
      exited: proc.exited,
    };
  }

  const proc = spawn(cmd[0]!, cmd.slice(1), {
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const killTimer = setTimeout(() => {
    proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2000).unref();
  }, effectiveTimeout).unref();

  const stdoutPromise = new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    proc.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_STDOUT_BUFFER_SIZE) {
        chunks.push(chunk);
      }
    });
    proc.on("close", () => resolve(Buffer.concat(chunks).toString()));
  });
  const stderrPromise = new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    proc.stderr.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_STDERR_BUFFER_SIZE) {
        chunks.push(chunk);
      }
    });
    proc.on("close", () => resolve(Buffer.concat(chunks).toString()));
  });
  const exitedPromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => {
      clearTimeout(killTimer);
      resolve(code ?? 1);
    });
  });

  return {
    stdout: stdoutPromise,
    stderr: stderrPromise,
    exited: exitedPromise,
  } satisfies SpawnedProcess;
}

function embeddedOxlintConfigContents(kind: EmbeddedOxlintScanKind): string {
  if (kind === "import") {
    return JSON.stringify({
      plugins: ["import"],
      rules: {
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
                message:
                  "Prefer Angular Material secondary entry-point imports for CI tooling cost.",
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
      },
    });
  }

  return JSON.stringify({
    plugins: ["jest", "oxc"],
    categories: {
      correctness: "off",
      suspicious: "off",
      pedantic: "off",
      perf: "off",
      style: "off",
      restriction: "off",
      nursery: "off",
    },
    rules: {
      "jest/no-large-snapshots": ["warn", { maxSize: 300, inlineMaxSize: 50 }],
      "oxc/no-barrel-file": "warn",
    },
  });
}

function embeddedOxlintLabel(kind: EmbeddedOxlintScanKind): string {
  return kind === "import" ? "embedded-oxlint-import" : "embedded-oxlint-non-import";
}

let cachedOxlintBinPath: string | undefined;

export async function bundledOxlintBinPath(
  accessSync?: (p: string) => void,
  resolvePackage?: (spec: string) => string | URL | Promise<string | URL>,
): Promise<string | undefined> {
  if (cachedOxlintBinPath !== undefined && !accessSync && !resolvePackage) {
    return cachedOxlintBinPath;
  }

  const binaryName = process.platform === "win32" ? "oxlint.exe" : "oxlint";
  const startDir =
    (import.meta as { dir?: string }).dir ?? path.dirname(fileURLToPath(import.meta.url));
  const fsAccess = accessSync ?? require("node:fs").accessSync;
  const pkgResolve = resolvePackage ?? ((spec: string) => import.meta.resolve(spec));

  try {
    const pkgUrl = await pkgResolve("oxlint/package.json");
    const pkgRoot = path.dirname(fileURLToPath(pkgUrl instanceof URL ? pkgUrl : new URL(pkgUrl)));
    const binPath = path.resolve(pkgRoot, "bin", binaryName);
    fsAccess(binPath);
    cachedOxlintBinPath = binPath;
    return binPath;
  } catch {
    // fallback: walk up from startDir
  }

  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.resolve(dir, "node_modules", ".bin", binaryName);
    try {
      fsAccess(candidate);
      cachedOxlintBinPath = candidate;
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  cachedOxlintBinPath = undefined;
  return undefined;
}

function bundledOxlintJsPath(binPath: string): string {
  const binDir = path.dirname(require("node:fs").realpathSync(binPath));
  return path.resolve(binDir, "..", "dist", "cli.js");
}

function parseOxlintLine(line: string): OxlintDiagnostic | undefined {
  const match = OXLINE_RE.exec(line);
  if (!match) {
    return undefined;
  }
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
    const oxlintPath = await bundledOxlintBinPath();
    if (!oxlintPath) {
      context.warn(
        source,
        "Oxlint package not found via module resolution. Skipping oxlint-based diagnostics. Install oxlint or ensure the package is available in node_modules.",
      );
      warnings?.push(...localWarnings);
      return undefined;
    }
    if (!(await context.pathExists(oxlintPath))) {
      context.warn(
        source,
        `Oxlint binary not found at resolved path: ${oxlintPath}. Skipping oxlint-based diagnostics.`,
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

    const oxlintArgs = [
      "-c",
      configPath,
      "-f",
      "unix",
      "--no-error-on-unmatched-pattern",
      "--disable-nested-config",
      ...ignorePatternFlags,
      ".",
    ];
    const cmd =
      typeof Bun !== "undefined"
        ? ["bun", bundledOxlintJsPath(oxlintPath), ...oxlintArgs]
        : [oxlintPath, ...oxlintArgs];
    const { stdout, stderr, exited } = spawnOxlintProcess(cmd, repoRoot);
    const [stdoutText, stderrText, exitCode] = await Promise.all([stdout, stderr, exited]);

    if (exitCode === -1 || (exitCode !== 0 && exitCode > 128)) {
      const skipped =
        kind === "import"
          ? "import restriction and extension checks"
          : "barrel file and snapshot checks";
      process.stderr.write(
        `[${source}] Oxlint scan timed out after ${EMBEDDED_OXLINT_TIMEOUT_MS}ms. ${skipped} skipped for ${repoRoot}.\n`,
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
      if (!line) {
        continue;
      }
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
