# Dockerfile apt install without no-install-recommends

`apt-get install` installs recommended packages by default. In CI-built Docker images, those extra packages often increase layer size without improving the runtime image.

Use `--no-install-recommends` unless the recommended dependencies are intentionally required.

The scanner checks direct `apt-get install` and `apt install` commands in shell or JSON-form `RUN`, including `ONBUILD RUN`. Options before the install action and simple `sudo`/`env` wrappers are recognized. Each command is checked independently: a flag on another install or inside quoted text does not suppress a finding.

`--no-install-recommends` and explicit `APT::Install-Recommends=false` options (via `-o` or `--option`) suppress the finding. Boolean alternatives `0`, `no` and `off` are also accepted. A later explicit setting can enable recommendations again. Unknown base-image apt configuration is not resolved; custom config files, simulations, heredocs and uncertain shell control flow are excluded. One finding per Dockerfile points to the first affected instruction.

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
```
