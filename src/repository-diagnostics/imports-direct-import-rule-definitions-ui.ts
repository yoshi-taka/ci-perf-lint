import type { RepositorySignals } from "../repository-signals-types.ts";
import {
  angularMaterialDirectImportMeta,
  antdDirectImportMeta,
  headlessUiFloatReactDirectImportMeta,
  headlessUiReactDirectImportMeta,
  materialUiV4DirectImportMeta,
  muiBarrelImportMeta,
  muiCoreDirectImportMeta,
  reactBootstrapDirectImportMeta,
  tremorDirectImportMeta,
  visxDirectImportMeta,
} from "./imports-metadata.ts";
import {
  createMuiBarrelImportContent,
  dependencyIndexHasAnyDependency,
  makeContent,
  type MakeContentOptions,
  type RestrictedImportRuleDefinition,
} from "./imports-direct-import-shared.ts";

interface UiEntryData extends MakeContentOptions {
  depNames: readonly string[];
  meta:
    | typeof angularMaterialDirectImportMeta
    | typeof antdDirectImportMeta
    | typeof headlessUiFloatReactDirectImportMeta
    | typeof headlessUiReactDirectImportMeta
    | typeof materialUiV4DirectImportMeta
    | typeof muiCoreDirectImportMeta
    | typeof reactBootstrapDirectImportMeta
    | typeof tremorDirectImportMeta
    | typeof visxDirectImportMeta;
  exactSources: readonly string[];
}

const standardUiDefs: UiEntryData[] = [
  {
    depNames: ["@material-ui/core", "@material-ui/icons"],
    meta: materialUiV4DirectImportMeta,
    exactSources: ["@material-ui/core", "@material-ui/icons"],
    defaultContextText: "Top-level Material UI v4 import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level Material UI v4 import",
    why: "Next.js optimizes `@material-ui/core` and `@material-ui/icons` by default because these top-level entries expose many components and icons. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      "Replace top-level Material UI v4 named imports with direct imports, for example `@material-ui/core/Button` or `@material-ui/icons/Add`.",
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Material UI v4 imports with direct component and icon imports.",
    aiHandoff:
      "Find imports from `@material-ui/core` and `@material-ui/icons`, then rewrite named component and icon imports to direct Material UI v4 subpath imports such as `@material-ui/core/Button` or `@material-ui/icons/Add`. Preserve already-direct Material UI v4 imports.",
    score: 73,
  },
  {
    depNames: ["mui-core"],
    meta: muiCoreDirectImportMeta,
    exactSources: ["mui-core"],
    defaultContextText: "Top-level mui-core import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level mui-core import",
    why: "Next.js optimizes `mui-core` by default because its top-level entry can expose many Material UI components. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      "Replace top-level `mui-core` named imports with direct component imports supported by the installed package version, or migrate to the maintained Material UI package layout where feasible.",
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level mui-core imports with direct component imports.",
    aiHandoff:
      "Find imports from the `mui-core` package root and rewrite named component imports to direct component subpath imports supported by the installed package version. If the package is legacy compatibility code, consider whether the project should migrate to the maintained Material UI package layout instead.",
    score: 72,
  },
  {
    depNames: ["antd"],
    meta: antdDirectImportMeta,
    exactSources: ["antd"],
    defaultContextText: "Top-level antd import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level antd import",
    why: "Next.js optimizes `antd` by default because its top-level entry exposes many components. Ant Design supports ES module tree shaking, but CI tooling such as Jest, TypeScript, lint, and build steps may still pay module graph and transform cost when importing from the package root.",
    suggestion:
      'Replace top-level `antd` named imports with direct component imports, for example `import Button from "antd/es/button"`, or use a framework-supported import optimizer. Check style handling before applying manual direct imports broadly.',
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level antd imports with direct component imports.",
    aiHandoff:
      "Find imports from the `antd` package root and rewrite named component imports to direct `antd/es/<component>` imports where compatible. Preserve style behavior, because Ant Design component styles may be handled by framework config, global CSS, or babel-plugin-import.",
    score: 73,
  },
  {
    depNames: ["@visx/visx"],
    meta: visxDirectImportMeta,
    exactSources: ["@visx/visx"],
    defaultContextText: "Top-level @visx/visx import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level @visx/visx import",
    why: "Next.js optimizes `@visx/visx` by default because it is an umbrella entry for many visx packages. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      "Replace top-level `@visx/visx` named imports with direct package imports supported by the installed visx version, for example `@visx/shape`, `@visx/scale`, or `@visx/group`.",
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level @visx/visx imports with direct @visx package imports.",
    aiHandoff:
      "Find imports from the `@visx/visx` package root and rewrite named imports to direct @visx package imports supported by the installed visx version. Preserve already-direct @visx package imports.",
    score: 74,
  },
  {
    depNames: ["@tremor/react"],
    meta: tremorDirectImportMeta,
    exactSources: ["@tremor/react"],
    defaultContextText: "Top-level @tremor/react import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level @tremor/react import",
    why: "Next.js optimizes `@tremor/react` by default because its top-level entry exposes many dashboard components. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      "Replace top-level `@tremor/react` named imports with direct component imports supported by the installed Tremor version, or rely on framework-supported import optimization where available.",
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level @tremor/react imports with direct component imports.",
    aiHandoff:
      "Find imports from the `@tremor/react` package root and rewrite named component imports to direct component subpath imports supported by the installed Tremor version. Preserve already-direct Tremor imports.",
    score: 73,
  },
  {
    depNames: ["react-bootstrap"],
    meta: reactBootstrapDirectImportMeta,
    exactSources: ["react-bootstrap"],
    defaultContextText: "Top-level react-bootstrap import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level react-bootstrap import",
    why: "Next.js optimizes `react-bootstrap` by default because its top-level entry exposes many components. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      'Replace top-level `react-bootstrap` named imports with direct component imports, for example `import Button from "react-bootstrap/Button"`.',
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level react-bootstrap imports with direct component imports.",
    aiHandoff:
      "Find imports from the `react-bootstrap` package root and rewrite named component imports to direct `react-bootstrap/<Component>` imports. Preserve already-direct react-bootstrap component imports.",
    score: 73,
  },
  {
    depNames: ["@headlessui/react"],
    meta: headlessUiReactDirectImportMeta,
    exactSources: ["@headlessui/react"],
    defaultContextText: "Top-level @headlessui/react import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level @headlessui/react import",
    why: "Next.js optimizes `@headlessui/react` by default because its top-level entry exposes many components. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      "Replace top-level `@headlessui/react` named imports with direct component imports supported by the installed package version, or rely on framework-supported import optimization where available.",
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Headless UI React imports with direct component imports.",
    aiHandoff:
      "Find imports from the `@headlessui/react` package root and rewrite named component imports to direct component subpath imports supported by the installed package version. Preserve already-direct Headless UI imports.",
    score: 72,
  },
  {
    depNames: ["@headlessui-float/react"],
    meta: headlessUiFloatReactDirectImportMeta,
    exactSources: ["@headlessui-float/react"],
    defaultContextText:
      "Top-level @headlessui-float/react import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level @headlessui-float/react import",
    why: "Next.js optimizes `@headlessui-float/react` by default because its top-level entry can expose multiple components and helpers. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      "Replace top-level `@headlessui-float/react` named imports with direct imports supported by the installed package version, or rely on framework-supported import optimization where available.",
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Headless UI Float imports with direct imports.",
    aiHandoff:
      "Find imports from the `@headlessui-float/react` package root and rewrite named imports to direct subpath imports supported by the installed package version. Preserve already-direct Headless UI Float imports.",
    score: 71,
  },
  {
    depNames: ["@angular/material"],
    meta: angularMaterialDirectImportMeta,
    exactSources: ["@angular/material"],
    defaultContextText: "Top-level @angular/material import detected by embedded Oxlint scan.",
    flaggedDescription: "a top-level @angular/material import",
    why: "Next.js optimizes `@angular/material` by default because the root package can expose many component modules. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
    suggestion:
      "Replace top-level `@angular/material` imports with Angular Material secondary entry points such as `@angular/material/button`, `@angular/material/icon`, or `@angular/material/form-field`.",
    measurementHint:
      "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Angular Material imports with secondary entry-point imports.",
    aiHandoff:
      "Find imports from the `@angular/material` package root and rewrite each symbol to the Angular Material secondary entry point supported by the installed version. Preserve already-secondary Angular Material imports.",
    score: 73,
  },
];

function toUiDef(
  dependencyIndex: ReadonlySet<string>,
  data: UiEntryData,
): RestrictedImportRuleDefinition {
  return {
    enabled: dependencyIndexHasAnyDependency(dependencyIndex, data.depNames),
    meta: data.meta,
    exactSources: data.exactSources,
    content: makeContent(data),
  };
}

export function createUiImportRuleDefinitions(
  repository: RepositorySignals,
  dependencyIndex: ReadonlySet<string>,
  usesMui: boolean,
): RestrictedImportRuleDefinition[] {
  return [
    {
      enabled: usesMui,
      meta: muiBarrelImportMeta,
      matches: (source) => typeof source === "string" && /^@mui\/[^/]+$/.test(source),
      content: createMuiBarrelImportContent(repository),
    },
    ...standardUiDefs.map((d) => toUiDef(dependencyIndex, d)),
  ];
}
