# dockerfile-final-stage-copies-broad-context

Detects Dockerfiles where the final image stage copies the broad build context.

This rule looks for:

- final-stage `COPY . .`
- final-stage `ADD . .`

It skips copies from another stage such as `COPY --from=builder ...`.

Why it matters:

- A final-stage broad copy can carry source files, generated output, dependency directories, local metadata, and build-only files into the runtime image.
- This increases image size and can make final image layers change more often.
- Smaller final images are usually faster to push, pull, scan, and deploy.

What to do:

- Use a multi-stage build.
- Copy only runtime artifacts into the final image.
- Prefer targeted `COPY --from=<builder>` instructions for built output and production dependencies.
