# dockerignore-misses-noisy-build-context-paths

Detects Docker build contexts where a `.dockerignore` file exists but still allows noisy root paths into the build context.

This rule looks for visible paths such as:

- `.git`
- `.github`
- `node_modules`
- `dist`
- `build`
- `.next`
- `.turbo`
- `coverage`

Why it matters:

- Broad `COPY` and `ADD` instructions can include these paths in image layers.
- Generated output, dependency folders, VCS metadata, and CI metadata can increase context transfer time and image size.
- These paths also change often, which can invalidate Docker cache layers unnecessarily.

What to do:

- Add ignore entries for noisy paths that are not intentionally copied into the image.
- Keep `.dockerignore` next to the Docker build context, not only at the repository root when building a subdirectory context.
- Measure Docker build context size and broad COPY layer size before and after tightening the ignore file.
