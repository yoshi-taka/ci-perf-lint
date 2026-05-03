import {
  dateFnsDirectImportMeta,
  effectDirectImportMeta,
  lodashEsDirectImportMeta,
  ramdaDirectImportMeta,
  reactUseDirectImportMeta,
  rechartsDirectImportMeta,
  rxjsDirectImportMeta,
} from "./imports-metadata.ts";
import {
  dependencyIndexHasAnyDependency,
  dependencyIndexHasEffectDependency,
  makeContent,
  regexMatcher,
  type RestrictedImportRuleDefinition,
} from "./imports-direct-import-shared.ts";

export function createUtilityImportRuleDefinitions(
  dependencyIndex: ReadonlySet<string>,
): RestrictedImportRuleDefinition[] {
  return [
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["date-fns"]),
      meta: dateFnsDirectImportMeta,
      exactSources: ["date-fns"],
      content: makeContent({
        defaultContextText: "Top-level date-fns import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level date-fns import",
        why: "Next.js optimizes `date-fns` by default because its top-level entry exports many functions. Production bundlers can usually tree-shake it, but CI tooling such as TypeScript, Jest, lint, and build steps may still pay module graph and type-processing cost when importing from the package root.",
        suggestion:
          'Replace top-level `date-fns` named imports with direct imports, for example `import format from "date-fns/format"`. Leave subpath imports such as `date-fns/locale` and `date-fns/fp` alone unless they show up in measurements.',
        measurementHint:
          "Compare TypeScript, Jest, lint, or build wall-clock time before and after replacing top-level date-fns imports with direct function imports.",
        aiHandoff:
          "Find imports from the `date-fns` package root and rewrite each named function import to a direct `date-fns/<function>` import. Preserve existing `date-fns/locale`, `date-fns/fp`, and already-direct function imports.",
        score: 74,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["lodash-es"]),
      meta: lodashEsDirectImportMeta,
      exactSources: ["lodash-es"],
      content: makeContent({
        defaultContextText: "Top-level lodash-es import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level lodash-es import",
        why: "Next.js optimizes `lodash-es` by default because its top-level entry exports many functions. CI tooling such as Jest, TypeScript, lint, and build steps may pay heavy startup or module graph cost when importing from the package root; upstream Jest/Angular reports show large startup differences from replacing root `lodash-es` imports with direct function imports.",
        suggestion:
          'Replace top-level `lodash-es` named imports with direct imports, for example `import debounce from "lodash-es/debounce"`.',
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level lodash-es imports with direct function imports.",
        aiHandoff:
          "Find imports from the `lodash-es` package root and rewrite each named function import to a direct `lodash-es/<function>` import. Preserve already-direct lodash-es subpath imports.",
        score: 76,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["ramda"]),
      meta: ramdaDirectImportMeta,
      exactSources: ["ramda"],
      content: makeContent({
        defaultContextText: "Top-level ramda import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level ramda import",
        why: "Next.js optimizes `ramda` by default because its top-level entry exports many utility functions. CI tooling such as Jest, TypeScript, lint, and build steps may pay startup or module graph cost when importing from the package root.",
        suggestion:
          "Replace top-level `ramda` named imports with direct function imports supported by the installed Ramda version, for example `ramda/src/pipe`, and verify the package export path in this project before applying broadly.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level ramda imports with direct function imports.",
        aiHandoff:
          "Find imports from the `ramda` package root and rewrite named function imports to direct function imports supported by the installed Ramda version. Preserve already-direct ramda subpath imports.",
        score: 72,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["rxjs"]),
      meta: rxjsDirectImportMeta,
      exactSources: ["rxjs"],
      content: makeContent({
        defaultContextText: "Top-level rxjs import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level rxjs import",
        why: "Next.js optimizes `rxjs` by default because the top-level entry exposes many observables, creation functions, subjects, schedulers, and operators. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
        suggestion:
          "Replace top-level `rxjs` named imports with direct RxJS subpath imports supported by the installed version, and keep existing `rxjs/operators` imports when that is the compatible path for the project.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level rxjs imports with direct RxJS subpath imports.",
        aiHandoff:
          "Find imports from the `rxjs` package root and rewrite named imports to direct RxJS subpath imports supported by the installed version. Preserve existing compatible `rxjs/operators` and other already-direct RxJS subpath imports.",
        score: 72,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["recharts"]),
      meta: rechartsDirectImportMeta,
      exactSources: ["recharts"],
      content: makeContent({
        defaultContextText: "Top-level recharts import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level recharts import",
        why: "Next.js optimizes `recharts` by default because its top-level entry exposes many chart components and utilities. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
        suggestion:
          "Replace top-level `recharts` named imports with direct imports supported by the installed Recharts version, or rely on framework-supported import optimization where available.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level recharts imports with direct imports.",
        aiHandoff:
          "Find imports from the `recharts` package root and rewrite named imports to direct Recharts subpath imports supported by the installed version. Preserve already-direct Recharts imports.",
        score: 73,
      }),
    },
    {
      enabled: dependencyIndexHasEffectDependency(dependencyIndex),
      meta: effectDirectImportMeta,
      matches: (source) => source === "effect" || regexMatcher("^@effect/[^/]+$")(source),
      content: makeContent({
        defaultContextText: "Top-level Effect import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level Effect import",
        why: "Next.js optimizes `effect` and `@effect/*` by default because these entries can expose many modules. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from top-level package entries.",
        suggestion:
          "Replace top-level `effect` and `@effect/<package>` imports with direct subpath imports supported by the installed Effect package versions, or rely on framework-supported import optimization where available.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Effect imports with direct subpath imports.",
        aiHandoff:
          "Find imports from `effect` and one-segment `@effect/<package>` entries, then rewrite named imports to direct Effect subpath imports supported by the installed package versions. Preserve already-direct Effect subpath imports.",
        score: 72,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["react-use"]),
      meta: reactUseDirectImportMeta,
      exactSources: ["react-use"],
      content: makeContent({
        defaultContextText: "Top-level react-use import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level react-use import",
        why: "Next.js optimizes `react-use` by default because its top-level entry exposes many hooks and utilities. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the package root.",
        suggestion:
          "Replace top-level `react-use` named imports with direct hook imports supported by the installed react-use version, for example `react-use/lib/useToggle`.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level react-use imports with direct hook imports.",
        aiHandoff:
          "Find imports from the `react-use` package root and rewrite named hook imports to direct hook subpath imports supported by the installed react-use version. Preserve already-direct react-use imports.",
        score: 72,
      }),
    },
  ];
}
