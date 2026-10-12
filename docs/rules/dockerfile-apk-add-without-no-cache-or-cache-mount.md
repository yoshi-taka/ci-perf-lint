# dockerfile-apk-add-without-no-cache-or-cache-mount

Detects direct `apk add` commands in shell or JSON-form Dockerfile `RUN` and `ONBUILD RUN` instructions that do not use `--no-cache` or a BuildKit cache/tmpfs mount covering the effective apk cache directory.

This rule looks for:

- `RUN apk add ...`

and reports when the instruction lacks both:

- `--no-cache`
- a cache or tmpfs mount covering the effective cache directory (`/var/cache/apk` by default, or a literal absolute `--cache-dir` override)

Mount option order and `target`/`dst`/`destination` aliases are supported. Parent directory mounts cover the cache; subdirectories, similarly named paths and secret mounts do not. Tmpfs avoids persisting the cache but does not preserve it across builds.

Options before `add`, simple wrappers and command-local `--no-cache` are recognized. A flag on another command, in a comment or inside echoed text does not suppress the finding. Explicit package versions do not disable caching. Simulations, custom roots, unresolved cache paths, heredocs and uncertain shell control flow are excluded. One finding per Dockerfile points to the first affected instruction.

Why it matters:

- apk package indexes and cache data can increase image layer size.
- `--no-cache` keeps simple runtime package installs small.
- A BuildKit cache mount keeps package cache data out of the image while still allowing repeated builds to reuse it.

What to do:

- Use `apk add --no-cache` for straightforward installs.
- Use a BuildKit cache mount for `/var/cache/apk` when cache reuse is intentional.
- Compare image layer size and rebuild time before and after the change.
