import { fontAwesomeIconPackRoots } from "./direct-import-roots.ts";
import {
  antDesignIconsDirectImportMeta,
  fontAwesomeDirectImportMeta,
  heroiconsDirectImportMeta,
  lucideAngularIconsMeta,
  lucideDynamicIconMeta,
  reactIconsDirectImportMeta,
  svgComponentImportMeta,
  tablerIconsDirectImportMeta,
} from "./imports-metadata.ts";
import { isAllowedSvgComponentImporterPath } from "./imports-shared.ts";
import {
  dependencyIndexHasAnyDependency,
  makeContent,
  regexMatcher,
  suffixMatcher,
  type RestrictedImportRuleDefinition,
} from "./imports-direct-import-shared.ts";

export function createIconAndAssetImportRuleDefinitions(
  dependencyIndex: ReadonlySet<string>,
): RestrictedImportRuleDefinition[] {
  return [
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["lucide-react"]),
      meta: lucideDynamicIconMeta,
      exactSources: ["lucide-react/dynamic"],
      content: makeContent({
        defaultContextText: "Lucide DynamicIcon import detected by embedded Oxlint scan.",
        flaggedDescription: "a Lucide dynamic icon import",
        why: "Lucide recommends direct icon imports for static icons. `lucide-react/dynamic` is useful for data-driven icon names, but it imports all icons during build time and can increase build work, generated modules, network requests, and loading flashes.",
        suggestion:
          "Replace `DynamicIcon` with direct `lucide-react` icon imports when the icon set is statically known. Keep `DynamicIcon` only for genuinely data-driven names, such as icons selected by CMS content.",
        measurementHint:
          "Compare dev startup, build wall-clock time, generated module count, and client chunk/network request behavior before and after replacing static `DynamicIcon` usage.",
        aiHandoff:
          "Review `lucide-react/dynamic` imports. If icon names are statically known, replace `DynamicIcon` usage with direct `lucide-react` icon imports; if names come from CMS or external data, document that exception and keep the dynamic component.",
        score: 64,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["lucide-angular"]),
      meta: lucideAngularIconsMeta,
      exactSources: ["lucide-angular"],
      content: makeContent({
        defaultContextText:
          "Lucide Angular icons registry import detected by embedded Oxlint scan.",
        flaggedDescription: "a Lucide Angular icons registry import",
        why: "The `icons` export from `lucide-angular` represents the icon registry pattern and can pull a large icon set into CI-time parsing and transforms. Static Angular icon usage should register or import only the icons the app needs.",
        suggestion:
          'Replace `import { icons } from "lucide-angular"` with explicit icon imports from `lucide-angular/icons` and register only the required icons.',
        measurementHint:
          "Compare TypeScript, lint, test, or build wall-clock time before and after replacing the Lucide Angular icons registry import with explicit icon imports.",
        aiHandoff:
          "Find `icons` named imports from `lucide-angular`. Rewrite them to explicit icon imports from `lucide-angular/icons` and adjust the local Angular icon provider or registry setup to include only the referenced icons. Preserve ordinary `lucide-angular` component imports and existing `lucide-angular/icons` imports.",
        score: 70,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["@ant-design/icons"]),
      meta: antDesignIconsDirectImportMeta,
      exactSources: ["@ant-design/icons"],
      content: makeContent({
        defaultContextText: "Top-level @ant-design/icons import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level @ant-design/icons import",
        why: "Next.js optimizes `@ant-design/icons` by default because icon packages expose many components. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the icon package root.",
        suggestion:
          "Replace top-level `@ant-design/icons` named imports with direct icon imports supported by the installed package version, for example `@ant-design/icons/StarOutlined`.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Ant Design icon imports with direct icon imports.",
        aiHandoff:
          "Find imports from the `@ant-design/icons` package root and rewrite named icon imports to direct icon subpath imports supported by the installed package version. Preserve already-direct icon imports.",
        score: 74,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["@tabler/icons-react"]),
      meta: tablerIconsDirectImportMeta,
      exactSources: ["@tabler/icons-react"],
      content: makeContent({
        defaultContextText:
          "Top-level @tabler/icons-react import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level @tabler/icons-react import",
        why: "Next.js optimizes `@tabler/icons-react` by default because icon packages expose many components from their package root. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from the icon package root.",
        suggestion:
          "Replace top-level `@tabler/icons-react` named imports with direct icon imports supported by the installed package version, for example `@tabler/icons-react/dist/esm/icons/IconSearch`.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Tabler icon imports with direct icon imports.",
        aiHandoff:
          "Find imports from the `@tabler/icons-react` package root and rewrite named icon imports to direct icon subpath imports supported by the installed package version. Preserve already-direct Tabler icon imports.",
        score: 74,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["@heroicons/react"]),
      meta: heroiconsDirectImportMeta,
      exactSources: [
        "@heroicons/react/20/solid",
        "@heroicons/react/24/solid",
        "@heroicons/react/24/outline",
      ],
      content: makeContent({
        defaultContextText: "Heroicons grouped icon import detected by embedded Oxlint scan.",
        flaggedDescription: "a grouped Heroicons import",
        why: "Next.js optimizes `@heroicons/react/20/solid`, `@heroicons/react/24/solid`, and `@heroicons/react/24/outline` by default because each entry can expose many icons. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from these grouped icon entries.",
        suggestion:
          "Replace grouped Heroicons named imports with direct icon imports supported by the installed @heroicons/react version, for example `@heroicons/react/24/solid/CheckIcon`.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing grouped Heroicons imports with direct icon imports.",
        aiHandoff:
          "Find imports from `@heroicons/react/20/solid`, `@heroicons/react/24/solid`, and `@heroicons/react/24/outline`, then rewrite named icon imports to direct icon subpath imports supported by the installed @heroicons/react version. Preserve already-direct Heroicons icon imports.",
        score: 74,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, ["react-icons"]),
      meta: reactIconsDirectImportMeta,
      matches: (source) => regexMatcher("^react-icons/[^/]+$")(source),
      content: makeContent({
        defaultContextText: "Grouped react-icons import detected by embedded Oxlint scan.",
        flaggedDescription: "a grouped react-icons import",
        why: "Next.js optimizes `react-icons/*` by default because each icon set entry can expose many icons. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from grouped icon-set entries.",
        suggestion:
          "Replace grouped `react-icons/<set>` named imports with direct icon imports supported by the installed react-icons version, for example `react-icons/fa/FaBeer`.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing grouped react-icons imports with direct icon imports.",
        aiHandoff:
          "Find imports from grouped `react-icons/<set>` entries and rewrite named icon imports to direct icon subpath imports supported by the installed react-icons version. Preserve already-direct react-icons icon imports.",
        score: 74,
      }),
    },
    {
      enabled: dependencyIndexHasAnyDependency(dependencyIndex, fontAwesomeIconPackRoots),
      meta: fontAwesomeDirectImportMeta,
      exactSources: fontAwesomeIconPackRoots,
      content: makeContent({
        defaultContextText:
          "Top-level Font Awesome icon pack import detected by embedded Oxlint scan.",
        flaggedDescription: "a top-level Font Awesome icon pack import",
        why: "Next.js optimizes Font Awesome icon packs by default because the package root can expose a large icon catalog. CI tooling such as Jest, TypeScript, lint, and build steps may pay module graph and transform cost when importing from icon pack roots.",
        suggestion:
          "Replace top-level Font Awesome icon pack named imports with direct icon subpath imports supported by the installed package version, for example `@fortawesome/free-solid-svg-icons/faCoffee`.",
        measurementHint:
          "Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Font Awesome icon pack imports with direct icon imports.",
        aiHandoff:
          "Find imports from Font Awesome icon pack package roots and rewrite named icon imports to direct icon subpath imports supported by the installed package version. Preserve framework wrapper imports such as `@fortawesome/angular-fontawesome` and already-direct icon imports.",
        score: 72,
      }),
    },
    {
      enabled: true,
      meta: svgComponentImportMeta,
      matches: (source, relativePath) =>
        !isAllowedSvgComponentImporterPath(relativePath) &&
        suffixMatcher(".svg", ".svg?react", ".svg?vue", ".svg?component")(source),
      content: makeContent({
        defaultContextText: "SVG component import detected by embedded Oxlint scan.",
        flaggedDescription: "an SVG component import",
        why: "Converting SVG assets into React, Vue, or similar framework components moves asset bytes through the JavaScript transform and component runtime path. URL or string asset imports let the bundler keep SVG handling in the asset pipeline and avoid framework-specific component work.",
        suggestion:
          "Replace ordinary SVG component imports with URL/string asset imports, such as a default `*.svg` asset import or the bundler's explicit `?url` form. Keep component imports in explicit icon or design-system component directories when the SVG needs props, animation, dynamic styling, or reuse as a UI primitive.",
        measurementHint:
          "Compare JavaScript transform time, bundle/module counts, and build output before and after moving repeated SVG component imports back to asset URL imports.",
        aiHandoff:
          "Find SVG imports flagged by `eslint(no-restricted-imports)`. Replace ordinary `ReactComponent` imports and `*.svg?react` or `*.svg?component` imports with URL/string asset imports. Preserve componentized SVGs in explicit `icons/` or `icon-components/` directories, or when the file truly needs runtime props, animation, dynamic styling, or reusable UI-component behavior.",
        score: 68,
      }),
    },
  ];
}
