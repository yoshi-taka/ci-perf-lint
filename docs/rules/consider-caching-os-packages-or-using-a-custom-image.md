# consider-caching-os-packages-or-using-a-custom-image

Flags jobs that repeatedly install OS packages at runtime without visible package caching or a prebuilt image strategy.

## Why it matters

Repeated `apt` or `apt-get install` work can become a noticeable CI tax, especially on heavier build, test, release, or packaging jobs. For some jobs, caching package archives helps. For others, a custom or prebuilt image is the cleaner long-term fix.

This rule intentionally does not force a single solution. It points to two common paths:

- cache OS package artifacts when that reduces repeated install time
- move the dependency set into a custom or prebuilt image when the same packages are needed every run

The rule can escalate to `warning` when the package set looks heavy and the job itself appears heavy.

## Suggested fix

If this install path is slow enough to matter, measure both options:

- package-archive caching
- custom or prebuilt image

For repeated APT package sets on hosted Ubuntu, `awalsh128/cache-apt-pkgs-action@v1` is one concrete package-cache option. Prefer a custom or prebuilt image when the same heavy package set is required on most runs or package installation scripts make cache restore brittle.

Keep the change only if total job time improves.

## Measurement hint

Compare:

- package-install wall-clock time
- cache restore/save time, if added
- image pull/build overhead, if changed
- total job duration
