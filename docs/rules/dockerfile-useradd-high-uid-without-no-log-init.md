# dockerfile-useradd-high-uid-without-no-log-init

## Why it matters

`useradd` normally initializes lastlog/faillog entries. With a large UID, these can become logically large sparse files. Docker documents a sparse-file export issue that can expand `/var/log/faillog` in a container layer, increasing image storage and export/transfer work. The effect depends on the base image's account tools, configuration and exporter.

## What it flags

Direct Dockerfile `useradd` commands with a literal UID of at least 100000, without `--no-log-init` or `-l`. This six-digit cutoff is a conservative heuristic, not a universal performance threshold. Numeric values are checked, so leading zeros do not make a normal UID high.

Separate, attached and combined UID flags are recognized (`-u 123456`, `-u123456`, `-mu123456`, `--uid=123456`). Short-option groups stop at value-taking options: letters in attached shell/home/comment values are not treated as flags. A later UID option overrides an earlier one. Non-integer, unresolved or numerically unsafe UID values are not inferred.

The rule follows the selected build stage and its rootfs ancestry. Artifact-only `COPY --from` does not bring account logs into the output; explicit copies of the log paths are considered. Findings consolidate per Dockerfile.

Dynamic UIDs, `adduser`, help/defaults commands, custom root/prefix options, and uncertain shell control flow are excluded. Visible same-RUN removal of both accounting files suppresses the finding; later-RUN deletion cannot reclaim earlier layers. Base-image configuration is not executed or inspected, so verify whether log initialization is already disabled.

Both logs may be removed by separate commands in the same RUN. Cleanup commands using `rm --help` or `rm --version` do not establish removal.

## Suggested action

```dockerfile
RUN useradd --no-log-init -u 123456 -m app
```

Use this when login accounting is unnecessary in the container. Preserve UID/GID, group membership, home directory, shell and permissions. Do not lower the UID to silence the rule.

## Verification

Compare image layer/export bytes, export duration and push/pull time. Verify the account's identifiers, permissions and runtime behavior. No automatic rewrite is applied.

## References

- [Docker build best practices: USER](https://docs.docker.com/build/building/best-practices/#user) — sparse-file expansion and `--no-log-init` workaround.
- [shadow-utils useradd manual](https://github.com/shadow-maint/shadow/blob/master/man/useradd.8.xml) — `--uid`, `--no-log-init`, and `LOG_INIT` configuration.
