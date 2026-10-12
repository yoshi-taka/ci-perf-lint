# Dockerfile base image uses floating tag

Untagged base images and `:latest` can move to new content independently of the repository. That makes rebuilds less predictable and can invalidate Docker cache layers even when application code has not changed.

Pin base images to a stable version tag, or use a digest when reproducibility is more important than automatically picking up base image changes.

The rule checks literal external images in `FROM` instructions. A stage alias is exempt only after its defining instruction: `FROM node AS node` still reports the untagged external image, and an alias defined later cannot suppress an earlier finding. References to previously defined stages, `scratch`, digest-pinned images, and unresolved build arguments are excluded. One finding per Dockerfile points to the first affected instruction.

```dockerfile
FROM node:22-bookworm-slim
```
