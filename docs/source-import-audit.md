# Native source audit

Import-cost, large-barrel and inline-snapshot findings use `oxc-parser`
in-process, not embedded Oxlint. JS/TS files and component script regions are
parsed once per analysis context and shared between these collectors. Target code and linter configuration are never
executed. Oxlint is now only a development dependency for this project's lint.

The audit reads static ESM imports and explicit re-exports from JS/JSX/TS/TSX,
including their `.mjs`, `.cjs`, `.mts`, `.cts` variants. Literal dynamic `import()`
also contributes a namespace reference, including no-substitution templates.
Import-cost/extension findings ignore type-only imports/exports, `require()`,
computed import paths and TypeScript import-equals. Type-only references can still
affect the static barrel type graph. Lazy imports do not add transitive barrel edges.
Package-import suggestions require runtime bindings; side-effect imports are
only checked for relative extensions. Local aliases do not hide imported names.
Advice for dynamic imports explicitly preserves lazy loading, promise behavior
and the consumed namespace/API; it is not a recommendation to hoist them to static imports.

`eslint-*` and `oxlint-*` disable/enable, disable-line and disable-next-line
comments are respected for `no-restricted-imports` and `import/extensions`.
The same directives work for `oxc/no-barrel-file` and `jest/no-large-snapshots`.
Rule-specific comments affect only that family; bare disables affect all four.
Common aliases `eslint/no-restricted-imports` and `import-x/extensions` work too.
This is a scoped escape hatch, not complete ESLint configuration compatibility.

Discovery uses the repository scan context and excludes vendor, generated build
directories, fixture and snapshot paths. `.eslintignore` is not loaded. Files
containing generated source outside those directories are not automatically
excluded. Vue/Svelte/Astro regions use bounded static markup/JS-boundary scanners.
No target preprocessors/config/hooks are loaded. Analysis
warnings report unsupported regions, skipped files and JS/TS parsing failures.
A partial audit is not evidence that those files are clean.

The extension check ignores package paths, type-only references, and loader
queries/fragments. Dotted paths such as `./app.controller` are checked when one
matching JS/TS source file exists with an additional extension. Exact assets win;
ambiguous and missing targets are not guessed. Package/dependency/framework gates
remain rule-specific. All four supported CI dialects can establish source-audit
eligibility; the former GitHub-only workflow-count prerequisite is removed.
Source checks have no Oxlint subprocess deadline or stdout limit, but still pay
source reading/parsing costs. `CI_PERF_LINT_DISABLE_OXLINT` and its prewarm variant
are obsolete and have no effect. Workflow-only analysis still avoids source
auditing and loading the native parser.

Barrel and snapshot thresholds/provenance are documented in
[detected-large-barrel-file](rules/detected-large-barrel-file.md) and
[large-jest-snapshot](rules/large-jest-snapshot.md). External `.snap` scanning
remains separate, but now parses generated assignments as syntax, decodes escaped
names/bodies and reports parse failures. It never executes templates.

## Component script scope

Vue normal/setup scripts, Svelte module/instance scripts and Astro frontmatter/
inline scripts retain original UTF-16 lines/columns directly, without compiler AST
offset conversions. HTML, styles and data-only JSON scripts are not treated
as JavaScript. Imports in supported JS/JSX/TS/TSX scripts use the same rules and
in-script suppression comments as ordinary source.

Astro server/client script environments are isolated. Vue/Svelte imports are
hoisted into module scope, matching framework-generated JS; ordinary instance
declarations remain in a child lexical frame for snapshot provenance. Unknown
script bindings withhold snapshots with a warning rather than inventing identity.
Literal imports in supported template expressions are audited, but template
snapshot identity is not inferred. Static external script sources contribute graph
edges; remote scripts are never fetched. Explicit JS/TS/JSX/TSX script languages,
including attributed Astro scripts, are parsed directly without preprocessing.
Preprocessors, unknown languages and unsupported
expression spans remain visibly outside scope. No target source executes.
Component inputs are capped at 4 MiB, 16 script regions and 128 template expressions.
Component extraction does not depend on `@vue/compiler-sfc`, `svelte` or `@astrojs/compiler`.
The scanner skips comments, styles, data/custom blocks and Vue `v-pre`; it handles
quoted attributes, nested JS delimiters, strings, template literals and regexes.
Oxc validates the extracted JS/TS; this is **not full framework grammar validation**.
Malformed/ambiguous boundaries fail closed. Nesting is capped at 64 JS delimiters
and 256 markup/block frames. Svelte each/key/await/snippet parameters, defaults,
spread/shorthand attributes and Vue v-for/slot bindings are audited as JS/TS
without executing bindings. Astro frontmatter, inline scripts, JSX expressions/
fragments and attributes use the same static extraction principles.
Preprocessor output is not evaluated. Astro additionally bounds metadata
collection and external references. The only runtime parser dependency is Oxc.

## Static reference maps

Barrel traversal also follows bounded, repository-local mapping evidence:

- The nearest `tsconfig.json`/`jsconfig.json`: JSONC, local/installed-package JSON
  `extends` and left-to-right extends arrays,
  inherited `baseUrl`/`paths` origins, exact/single-star paths and simple
  `files`/`include`/`exclude` selection. Multiple existing path targets or tied
  wildcard prefixes stay leaves; fallback targets must identify one source file.
  Project references discover custom config filenames; overlapping owners must
  agree on resolution settings or produce an ambiguity warning.
- Declared package.json workspaces (array or `packages` form) and pnpm workspace
  `*`/`**` patterns/exclusions. Duplicate package names stay leaves.
- Workspace `main`/`module`, unexported subpaths, literal `exports` and nearest
  package `imports`/self exports. Exact export keys win over single-star patterns.
  An exports map blocks unlisted subpaths. Conditional/array targets are followed
  only when every branch resolves to the same canonical source (up to eight
  levels and 32 alternatives); missing, conflicting or null branches stay leaves.
  `module` must agree with `main` or Node's implicit index; it cannot override a
  conflicting Node entrypoint merely because a bundler might prefer it.
- Relative, alias and package references to the same source file are counted once.
  Query/fragment requests and URI schemes are not redirected through local maps.

No target config, hook, package code or resolver plugin is executed. Traversal
never traverses source outside the repository inventory. Installed `extends` may
read JSON/JSONC in node_modules, with realpath containment inside the repository;
dependency source is not scanned. Configuration reads
are limited to 256 KiB each, 512 TS/JS configs/projects, 16 inheritance levels/bases,
2,048 manifests, 1,024 map keys and 16 alias targets. Unsupported/invalid config
and exhausted read budgets emit source-audit warnings. Unknown/ambiguous references
remain leaves, not claims of a clean or fully resolved module graph.

This is not TypeScript/Node/bundler equivalence: advanced glob syntax,
environment-dependent package branches, reference build/output redirection and
resolver plugins are not inferred. Alias traversal is disabled for configs with
`moduleSuffixes`, `rootDirs` or `customConditions`; the independent relative-path
graph still uses its documented unique-file heuristic, not these compiler options.

## Delivery checklist

These are detection improvements, not promises of ESLint/Oxlint compatibility.

- [x] Run the Z3 verification on Bun/WASM without Python or a product dependency.
- [x] Cover CR, LF, CRLF, U+2028 and U+2029 in locations and next-line suppression.
- [x] Extract Vue/Svelte/Astro script regions with bounded extractors and correct
  UTF-16 offsets, retaining explicit incomplete-audit warnings for skipped regions.
- [x] Audit literal template imports and external script edges; model Vue/Svelte
  module/instance snapshot scopes. Scope references were previously checked against
  framework-generated JS; current regression tests use a dependency-free static oracle.
  Target preprocessors are deliberately not executed (see limits below).
- [x] Detect literal dynamic imports; do not guess computed paths or execute code.
- [x] Extend barrel graph resolution to basic static tsconfig/workspace/package maps,
  including ambiguity and duplicate-target tests; never execute target config.
  On CDK `68c0ed8`, local workspace traversal recovers six of the nine previously
  legacy-only barrel paths. The three remaining `spec2cdk` roots each reach 73
  distinct references in the current graph (57 local files plus 16 package leaves).
  Unlike Oxlint's per-wildcard subtree sums, shared subtrees count once here.
  Broader traversal finds 291 barrels versus the previous 245; compatibility
  with legacy counts is not the specification.
- [x] Extend static maps to agreeing conditional exports, external/array extends and project
  references only with explicit resolution semantics and ambiguity controls.
- [x] Recognize omitted runtime extensions after dotted basenames, such as
  `./app.controller` pointing at `app.controller.ts`, without guessing asset types.
- [x] Support `@jest/globals` namespace imports with shadowing/write guards.
- [x] Follow lexically prior readonly `const` Jest aliases, including named imports,
  namespace property extraction/destructuring and chains, with write/shadow guards.
- [x] Recognize unwritten let/var aliases and exact synchronous one-argument
  wrappers, including hoisted function declarations; invalidate writes and duplicate
  bindings. General cross-file/reflective provenance is not claimed.
- [x] Parse external `.snap` escaping without regex truncation or execution;
  propagate parse-failure warnings. Target lint allowlists do not configure it.
- [x] Preserve completed source-audit warnings in the final analyzer report,
  without merging unrelated background/prewarm telemetry.
- [x] Validate the >80,000-file fallback and forced repository scan on a
  synthetic 81,003-file repository. This checks control flow, not parsing 81k
  source files; most synthetic files are tiny `.txt` entries.
- [x] Measure dependency-installed TypeScript `056d69e`: whole CLI 5.11 s wall,
  maximum RSS 418,840,576 bytes, normal findings exit 1 (two findings).
  Lifecycle scripts disabled. CDK dependency installation is blocked by absent
  generated workspaces; its shallow-clone measurements are not installed-CDK evidence.
- [x] Review remaining mutation survivors and timeout cases; retain the original
  statuses rather than equating timeouts with kills. The 1,601-mutant static-map/SFC
  trial remains 1,000 killed / 580 survived / 21 timed out. Separate bounded checks
  confirm six recursive-growth cases and 15 nonterminating ascent/loop cases;
  the same historical-source baseline passes 73 tests. Survivors remain explicit
  test limitations, not a blanket equivalence or correctness claim.
- [x] Extend mutation targets to scan orchestration and external snapshot parsing.
- [x] Extend mutation targets to collector gates/diagnostic construction and the
  static-map/SFC helpers; separate reports preserve each trial's scope and survivors.
- [x] Test all four source finding families through GitHub Actions, Buildkite,
  CircleCI and GitLab CI entrypoints; remove the GitHub-only count prerequisite.
- [x] Check scoped models with Z3, Lean, Alloy and TLA+, including real-code
  comparisons, positive controls and intentionally broken models. See `formal/README.md`.

## Deliberate static-analysis limits

Computed imports, require/import-equals cost advice, runtime configuration,
preprocessor output, reflective writes, arbitrary/transformed wrappers and
cross-file Jest identity are not inferred. Alias values must be lexically prior;
only function declarations get hoisting. Template imports do not establish Jest
binding provenance. These are scope boundaries, not hidden promises of complete
JavaScript or Oxlint compatibility. Partial-audit warnings and ambiguous leaves
must not be interpreted as a clean bill of health.
