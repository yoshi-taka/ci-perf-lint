# Dockerfile base image uses floating tag

Untagged base images and `:latest` can move to new content independently of the repository. That makes rebuilds less predictable and can invalidate Docker cache layers even when application code has not changed.

Pin base images to a stable version tag, or use a digest when reproducibility is more important than automatically picking up base image changes.

```dockerfile
FROM node:22-bookworm-slim
```

