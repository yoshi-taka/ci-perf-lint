# dockerfile-rpm-install-without-cleanup-or-cache-mount

## Why it matters

yum, dnf, microdnf and zypper can retain repository metadata and package caches in image layers. Removing them in a later `RUN` cannot reclaim the bytes in the earlier layer. Retained data adds storage, export, push, pull and extraction work.

## What it flags

Direct `install`/`in` commands, plus dnf `upgrade`/`up`, `upgrade-minimal`/`up-min` and `reinstall`/`rei`, in the selected output stage or its rootfs ancestry, without either:

- matching, complete native cleanup after the last install in the same `RUN`; or
- BuildKit cache or tmpfs mounts covering the cache paths.

One finding per Dockerfile lists affected instructions. Artifact-only transfers from independent builders do not carry their package metadata. Explicit cache-directory copies are considered.

Recognized native cleanup: `yum clean all`, `dnf clean all`, `microdnf clean all`, `zypper clean --all` / `zypper cc -a`. **Plain `zypper clean` only cleans downloaded packages**, leaving repository metadata. `dnf clean packages` is also incomplete.

Default path evidence is `/var/cache/yum` for yum/microdnf and `/var/cache/zypp` for zypper. The `dnf` executable can refer to DNF4 or DNF5; without version evidence, coverage of both `/var/cache/dnf` and `/var/cache/libdnf5` is required. A parent `/var/cache` mount covers both. Literal `--setopt=cachedir=...`, `--setopt=system_cachedir=...` and zypper `--cache-dir` overrides are recognized and cleanup must use the same cache path. DNF5 root uses `system_cachedir`: overriding only `cachedir` does not establish coverage for both implementations.

Tmpfs keeps cache writes out of the image without preserving them across builds. Cache/tmpfs mounts may be combined, and a mounted cache path can be combined with same-layer cleanup of the remaining paths. Separate `rm` commands after package work can collectively remove all cache directories. Removing only one unmounted dnf path, mounting a subdirectory, or using secret/unrelated mounts is insufficient.

Unknown custom configs, install roots, unresolved cache paths, dry runs and uncertain shell control flow are excluded. Base-image config files are not inspected. An unrelated mount, earlier cleanup, later-RUN cleanup or quoted command text does not establish cleanup. Disabling downloaded-package retention alone does not eliminate metadata caches.

## Suggested action

```dockerfile
RUN dnf install -y curl && dnf clean all
RUN zypper --non-interactive install curl && zypper clean --all
```

For rebuild reuse, mount the effective cache directories instead of baking their contents into the image. Preserve package selection and intentional cache reuse. Verify custom config and package-manager implementation before changing paths.

## Verification

Compare output layer size and cold/warm builds, including push and pull time. Test a dependency change that re-executes the install; an entirely cached `RUN` does not prove package-cache reuse.

## References

- [DNF clean command](https://dnf.readthedocs.io/en/latest/command_ref.html#clean-command) — metadata/package cleanup distinctions.
- [DNF5 configuration](https://dnf5.readthedocs.io/en/latest/dnf5.conf.5.html#system-cachedir-options-label) — system cache path.
- [Yum manual: clean options](https://github.com/rpm-software-management/yum/blob/master/docs/yum.8).
- [microdnf cache configuration](https://github.com/rpm-software-management/microdnf/blob/master/dnf/dnf-main.c) and [clean implementation](https://github.com/rpm-software-management/microdnf/blob/master/dnf/plugins/clean/dnf-command-clean.c).
- [openSUSE zypper manual](https://manpages.opensuse.org/Tumbleweed/zypper/zypper.8.en.html) — refresh/cache directories and `clean --all`.
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/) — stage inheritance and artifact-only transfers.
