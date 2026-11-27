# circleci-checkout-with-full-workspace

Detects a downstream CircleCI job that runs `checkout` after attaching a workspace that already contains the whole checked-out project.

## Detection

Reports when all of these hold:

- An upstream job reachable through workflow `requires` runs `persist_to_workspace` with a root equal to its working directory (`.`, `./`, `~/project`, `/home/circleci/project`, or the job's `working_directory`)
- The persisted paths contain `.`, `./`, `*`, or `./*`
- The downstream job runs both `checkout` and `attach_workspace`
- `attach_workspace.at` matches the resolved project directory and the downstream `checkout.path`
- The downstream job does not run git commands that need fresh remote state or checkout-provided SSH host keys, and does not use a release tool that pushes tags (`semantic-release`, `release-it`, `changesets`, `lerna publish` / `lerna version`, `standard-version`, `goreleaser`)

The workflow graph is resolved through `requires` in the same workflow.

## Exclusions

Does not report when:

- the persisted root or attach destination is a subdirectory such as `doc/_build/html`
- `checkout.path` differs from `attach_workspace.at`
- the downstream job pushes, fetches, pulls, runs a release tool that pushes tags, or has an `add_ssh_keys` step that depends on checkout's SSH setup
- the attach job is not reachable through `requires` from the persisting job

## Suggested fix

Either remove `checkout` from the downstream job, or narrow `persist_to_workspace.paths` to the build outputs the downstream job needs. Narrowing is preferred when the workspace includes dependency directories such as `node_modules`, `.venv`, or `vendor`.

## Measurement hint

Compare "Attaching Workspace" and "Checkout code" step times and the workspace size shown in the upstream job.
