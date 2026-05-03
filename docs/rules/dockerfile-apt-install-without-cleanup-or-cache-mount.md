# dockerfile-apt-install-without-cleanup-or-cache-mount

Detects Dockerfile `RUN` instructions that perform apt package work without either cleaning apt lists in the same layer or using BuildKit apt cache mounts.

This rule looks for:

- `RUN apt-get update`
- `RUN apt-get install ...`
- `RUN apt update`
- `RUN apt install ...`

and reports when the same instruction does not include either:

- `rm -rf /var/lib/apt/lists/*`
- a BuildKit cache mount for `/var/cache/apt` or `/var/lib/apt`

Why it matters:

- apt metadata and package indexes can be saved into image layers.
- Deleting those files in a later `RUN` instruction does not remove them from the earlier layer.
- BuildKit cache mounts can preserve repeated package-manager work without storing cache data in the final image.

What to do:

- Combine update, install, and cleanup in the same `RUN` instruction for simple images.
- Use BuildKit cache mounts for apt cache directories when repeated package downloads matter.
- Compare image layer size and rebuild time before and after the change.
