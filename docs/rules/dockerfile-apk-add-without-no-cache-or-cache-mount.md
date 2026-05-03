# dockerfile-apk-add-without-no-cache-or-cache-mount

Detects Dockerfile `RUN apk add` instructions that do not use `--no-cache` or a BuildKit cache mount.

This rule looks for:

- `RUN apk add ...`

and reports when the instruction lacks both:

- `--no-cache`
- `--mount=type=cache,target=/var/cache/apk`

Why it matters:

- apk package indexes and cache data can increase image layer size.
- `--no-cache` keeps simple runtime package installs small.
- A BuildKit cache mount keeps package cache data out of the image while still allowing repeated builds to reuse it.

What to do:

- Use `apk add --no-cache` for straightforward installs.
- Use a BuildKit cache mount for `/var/cache/apk` when cache reuse is intentional.
- Compare image layer size and rebuild time before and after the change.
