# `prefer-node-run-over-npm-run`

Detects simple GitHub Actions steps and package.json scripts that run package scripts through `npm run` when `node --run` may be a lower-overhead replacement.

Why this rule exists:

- `node --run <script>` can avoid npm startup overhead for simple package-script execution on recent Node.js versions
- this is most useful for short lint, format, and repository tooling steps where command startup is a meaningful share of total time

Important compatibility notes:

- `node --run` is not a universal drop-in replacement for `npm run`
- npm-specific `.npmrc` behavior is not applied in the same way
- npm-provided lifecycle environment variables may be absent or different
- npm `pre<script>` and `post<script>` lifecycle scripts are not run
- npm workspace flags and other npm CLI flags need separate review

The rule reports as a warning because the analyzer also collects visible compatibility evidence:

- `.npmrc` files in the repository, excluding noisy generated or vendored directories
- matching `pre<script>` and `post<script>` package scripts
- package scripts that reference npm-provided environment such as `npm_package_*`, `npm_lifecycle_*`, or `npm_config_*`
- workflow files that reference npm-related environment such as `NPM_CONFIG_*` or `NODE_AUTH_TOKEN`

Current MVP heuristic:

- for workflow steps, the step is a single-line command and the same job visibly configures `actions/setup-node` with Node.js 22 or newer
- for `package.json`, scripts are scanned for nested `npm run <script>` or `npm run-script <script>` delegation
- optional script arguments after `--` are allowed
- commands with npm flags or workspace flags are ignored
- workflow multiline scripts are ignored

Typical remediation:

- replace `npm run lint` with `node --run lint` only when the repository targets a Node.js version that supports it
- before changing, account for any compatibility evidence included in the finding
- measure the step duration before and after the change
