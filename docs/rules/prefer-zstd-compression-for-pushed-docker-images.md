# prefer-zstd-compression-for-pushed-docker-images

Shell evidence is scoped to each BuildKit build and its output options. Printed `--push` or compression text, label values and another build's exporter settings do not count. Both `--output` and `-o` forms are supported; each visibly pushed exporter is checked independently. Structured build-action inputs remain supported.

Detects pushed BuildKit Docker image builds that do not request zstd layer compression.

This rule looks for image pushes through:

- `docker/build-push-action`
- `depot/build-push-action`
- `docker buildx build --push`
- `depot build --push`
- BuildKit output containing `type=registry`

and reports when the output does not include:

- `compression=zstd`
- `oci-mediatypes=true`

Why it matters:

- BuildKit defaults to gzip layer compression.
- zstd can be faster to decompress and can reduce pull/startup time for frequently pulled CI or Kubernetes images.
- OCI media types are needed for zstd-compressed OCI layers.

What to do:

- Add output options such as `compression=zstd,oci-mediatypes=true`.
- Verify that the target registry and runtime support OCI zstd-compressed layers.
- Compare image push time, pull time, and startup latency before and after enabling zstd.

Example:

```yaml
- uses: depot/build-push-action@v1
  with:
    context: .
    tags: ghcr.io/acme/app:${{ github.sha }}
    push: true
    outputs: compression=zstd,oci-mediatypes=true
```
