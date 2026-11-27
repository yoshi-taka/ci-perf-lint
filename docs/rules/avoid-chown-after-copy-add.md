# avoid-chown-after-copy-add

## What it flags

Flags Dockerfiles that copy or add files to a path and then run `chown` on that same path in a later layer. The example is `ADD _build/deploy/rel /opt/app` followed by `RUN chown -R ... /opt/app`.

A copy that already uses `--chown` is not flagged.

## Why it matters

A later `chown` creates a new layer containing the copied files again with updated ownership. The earlier copy layer remains in the image history, so the release payload is effectively stored twice in the output image. That costs image size and push/pull time.

## Suggested action

Fold ownership into the copy itself, for example `COPY --chown=<user>:<group> _build/deploy/rel /opt/app` (or `ADD --chown=...`). Remove the now-redundant `chown` command only after verifying the resulting ownership and permissions.

## Measurement

Compare output image size and cold build time before and after the change. Verify that the destination ownership, file modes, and later build steps are unchanged.
