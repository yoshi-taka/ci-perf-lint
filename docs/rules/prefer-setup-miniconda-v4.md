# prefer-setup-miniconda-v4

## Why it matters

setup-miniconda v4 reduces setup work independently of its Node/ESM migration:

- removes HTML index scraping for Miniconda version validation;
- replaces environment-detection subprocesses with local YAML reads;
- replaces `conda config` subprocesses with direct `.condarc` YAML writes;
- avoids applying channel configuration twice;
- parallelizes Windows `takeown` calls;
- speeds Windows post-run cleanup by moving extracted package directories instead
  of deleting files individually.

Benefits vary by platform, installer and inputs. This is not a claim that v4 makes
Conda dependency solving universally faster or provides a fixed percentage gain.

## What it flags

conda-incubator/setup-miniconda refs with a known major below 4, including v1–v3
major tags, minor/patch tags and SHA pins with a numeric version comment.
It emits one warning per job in strict mode, on all operating systems.

Disabled jobs/steps, current v4+ refs, unknown SHAs, branches, expressions and
prereleases are excluded. Miniforge/mamba configurations remain applicable because
the Action's environment/configuration work is also improved. `run-post: false`
does not suppress setup improvements, though the cleanup benefit then does not apply.

## Suggested action

Upgrade the Action to v4 or later while preserving Python, Conda, Miniforge and
package versions; installer URLs; environment files; channels and solver settings;
activation; and shell initialization. This updates the Action, not the environment
or solver. Review self-hosted runner support for the Node 24 runtime.

Preserve deliberate cache and post-cleanup policies, and keep login shells/manual
activation where required. Switching to micromamba or disabling conda init is not
required to obtain these v4 improvements.

## Verification

Measure setup and post-cleanup steps with equivalent cache state and environment
files on cold/warm runs. Confirm installed versions, channel order, activated
environment and subsequent shell commands still match.

References:
- [v4 release](https://github.com/conda-incubator/setup-miniconda/releases/tag/v4.0.0)
- [Remove index scraping](https://github.com/conda-incubator/setup-miniconda/pull/486)
- [Parallel Windows takeown](https://github.com/conda-incubator/setup-miniconda/pull/487)
- [Local environment detection](https://github.com/conda-incubator/setup-miniconda/pull/488)
- [Direct configuration writes](https://github.com/conda-incubator/setup-miniconda/pull/489)
- [Windows cleanup](https://github.com/conda-incubator/setup-miniconda/pull/467)
