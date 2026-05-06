import { mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fontAwesomeIconPackRoots } from "./direct-import-roots.ts";

export type EmbeddedOxlintScanKind = "import" | "non-import";

const embeddedOxlintConfigPathPromises = new Map<EmbeddedOxlintScanKind, Promise<string>>();

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

export async function writeEmbeddedOxlintConfig(kind: EmbeddedOxlintScanKind): Promise<string> {
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
