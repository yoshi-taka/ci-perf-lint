# prefer-inner-loop-checks

## Why it matters

Dedicated lint/format jobs incur runner or container startup, checkout, and dependency setup even for fast deterministic checks. In mature agent-driven private development, these checks may be cheaper inside the development loop. Formatting is a lower-risk starting point than linting; AI does not make either tool obsolete.

## What it flags

A GitHub Actions job consisting exclusively of recognized lint/format commands and setup, when **all** conditions hold:

- Running inside GitHub Actions with an explicitly supplied `GH_TOKEN` or `GITHUB_TOKEN` and read access to Actions. The repository API confirms the target is private; public or unverified repositories are excluded. `--assume-visibility public` explicitly suppresses this rule; `private` does not bypass API verification. Package metadata and license absence do not establish visibility.
- Repository-wide agent instructions describe validation before submission **and** a validation skill or actual Claude command hook exists.
- Over the last **five complete weekdays**, the repository averages **at least 20 development-triggered workflow runs/day**, with activity on **at least three days**. Activity is collected once and shared across all candidates. Zero-activity weekdays remain in the denominator. Push, pull_request and merge_group runs count; schedule/manual runs do not. Multiple workflows triggered by the same push count separately: this measures repository CI load, not pushes or commits.
- Recognized checkout/toolchain/dependency setup takes **at least 60 seconds in one completed representative run**. The newest observed completed run of a candidate workflow is selected deterministically; its jobs are fetched once and shared across all candidate jobs in that workflow. Other workflows' setup costs are not inferred. This is a **single observation, not a median**; it measures selected setup steps, not queue time, total CI time, container boot, or billed minutes.

Both lint and formatting produce a medium-confidence **warning**, including in strict mode. No automatic deletion.

## Suggested action

Review whether agent-local checks can replace the dedicated job. Measure fixed setup costs first. Confirm equivalent commands, tool versions, actual execution, and that every contributor uses the controlled agent environment. Instructions and skills are evidence of investment, not proof of enforcement.

Retain independent CI validation for external/untrusted contributions, compliance, security-sensitive lint rules, or unreliable local execution. Update branch protections and downstream `needs` dependencies before retiring any job. A private repository can still have untrusted contributors.

## Verification

Compare runner minutes, startup/setup duration, and escaped lint/format failures. Do not trade mandatory correctness or security validation for speed. Test detection using miniature private fixtures; public OSS scans remain suppressed.

Example invocation (works with shallow checkout):

```yaml
permissions:
  contents: read
  actions: read
steps:
  - uses: actions/checkout@v4
  - run: bunx ci-perf-lint .
    env:
      GH_TOKEN: ${{ github.token }}
      TZ: Asia/Tokyo
```

Timezone is an IANA `TZ` (default **UTC**, not guessed from author locations). Today is excluded to avoid partial-day bias; Saturdays and Sundays are excluded in that timezone. Holidays are not excluded. Invalid timezone suppresses the rule. Calendar dates handle DST without assuming every local day is 24 hours.

## What the scanner does

Evidence requires two independent categories, not a score based on file counts:

1. **Policy:** root `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, or `.github/copilot-instructions.md` contains submission timing (before commit/push/PR, including common Japanese forms), validation terminology, and a recognizable CLI command. HTML comments are ignored. Nested policies are excluded because their scope may not cover the job.
2. **Operational artifact:** `.agents/skills/*/SKILL.md` or `.claude/skills/*/SKILL.md` contains a validation command; alternatively `.claude/settings.json` contains a command-type agent hook running validation. Permission allowlists, empty configuration, generic AI mentions, and commit hooks alone do not count.

This deliberately conservative first version uses textual heuristics, not semantic understanding or proof that a skill is invoked. It does not require the same lint command in the policy and job: it detects an established agent validation loop, then asks for equivalence review.

Job detection recognizes common JS, Python, Rust and Go lint/format tools. Package-script calls resolve to actual commands; unknown scripts, script lifecycle hooks, shell chains, tests/builds, unknown actions, services, conditional/matrix jobs, and working-directory overrides suppress the finding. It does not guess from a job or script named `lint`. Other CI platforms are not yet covered.

API access occurs only after static evidence and candidate jobs exist. The target root must equal `GITHUB_WORKSPACE` (real paths) and its origin must match `GITHUB_REPOSITORY` and the GitHub server. This deliberately skips alternate checkout paths and cross-repository audits. API origin is validated (including Enterprise `/api/v3`); credentials are never sent to response-provided URLs or redirects. Tokens are not read from checkout credentials.

Requests are GET-only and shared repository-wide: **one repository metadata request, one repository run-history request, and one representative run's jobs request**. Usually **three total**, regardless of candidate workflow/job count. Low activity stops before jobs. One additional 100-run history page is allowed if the first page cannot establish sustained activity or contains no candidate representative: **four requests maximum**, with a shared ten-second API deadline and a one-second local origin lookup. No per-workflow history calls or repeated job samples.

Observed runs can establish a conservative lower bound without exhausting pagination: if the observed subset alone satisfies both activity thresholds, the diagnostic explicitly says **at least**. It never extrapolates a partial page into a full-week estimate. Otherwise, insufficient evidence after two pages suppresses the rule. Missing token, permissions, retention/history, ambiguous job/step names, or API failures suppress unsupported findings without failing the audit. No fetch/unshallow, logs download, or full git-history scan. No local fallback yet.

The thresholds (20 repository runs/day, three active weekdays, 60s observed setup) are conservative **product heuristics**, not published industry cutoffs. Repository run frequency is not the individual candidate job's frequency: do not multiply these two numbers to claim savings. A single observation may be an outlier; verify before changing CI. Tune after observing real workloads. Repository creation/retention limits may make the five-day window incomplete; missing weekdays are counted as zero, never extrapolated.

## References

- [Stripe: Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents): local selected lint checks in under five seconds; fix locally before spending CI runs.
- [Stripe: Minions, Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2): deterministic lint inside the agent loop at over 1,300 agent PRs/week.
- [GitHub: Git infrastructure for agent-scale development](https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/): high push volume amplifies CI reads and infrastructure work; not a per-repository cutoff.
- [Uber's AI infra, The Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/ubers-ai-infra-from-the-inside): move simple validation into the agent inner loop after CI load doubled.
- [Birgitta Böckeler: Harness engineering](https://martinfowler.com/articles/harness-engineering.html#TimingKeepQualityLeft): place fast feedback before integration, while retaining repeated CI checks where appropriate. This supports early feedback, not unconditional CI deletion.
