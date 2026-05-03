# Dockerfile compiled build copies source layer

Compiled Docker builds often need source files only temporarily to produce a binary or build artifact. A broad `COPY . .` before `go build` or `cargo build` creates a source layer that changes frequently and can invalidate later layers.

For Go and Rust builder stages, consider using a BuildKit bind mount for the compile step and copying only the resulting artifact into the final image.

```dockerfile
RUN --mount=type=bind,target=. \
    --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o /app ./cmd/server
```

