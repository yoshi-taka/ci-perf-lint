# dockerfile-copy-link-without-cache-benefit

Detects `COPY --link` instructions whose cache benefit is unlikely to beat their build graph overhead.

This rule reports an error when `COPY --link` is used for:

- broad or frequently-changing paths such as `.`, `src/`, `app/`, `lib/`, `pkg/`, or `package*.json`
- non-final Docker stages
- small manifest-style copies such as `go.mod` or `package.json`
- copied destinations that are later modified by `RUN` instructions such as `chmod` or `chown`
- final-stage copies that are not limited to generated artifact directories

Why it matters:

- `COPY --link` separates the copy into an independently reusable layer.
- That separation has overhead.
- If the copied input changes often, is tiny, is in a frequently rebuilt intermediate stage, or is mutated right after copy, the reuse benefit usually disappears.

What to do:

- Remove `--link` from cache-hostile copy instructions.
- Keep `COPY --link` only for final-stage copies of stable generated artifacts such as `dist/`, `build/`, or `public/`.
- Measure Docker build wall-clock time and cache-hit behavior before and after the change.

Allowed shape:

```Dockerfile
FROM nginx:alpine
COPY --link dist/ /usr/share/nginx/html/
```
