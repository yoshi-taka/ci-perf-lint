# Dockerfile apt install without no-install-recommends

`apt-get install` installs recommended packages by default. In CI-built Docker images, those extra packages often increase layer size without improving the runtime image.

Use `--no-install-recommends` unless the recommended dependencies are intentionally required.

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
```

