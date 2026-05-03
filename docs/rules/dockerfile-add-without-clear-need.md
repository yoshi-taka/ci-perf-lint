# Dockerfile local ADD without clear need

`ADD` has extra behavior for remote URLs and archive extraction. For ordinary local files and directories, `COPY` is more explicit and avoids accidentally doing extra work in the Docker build.

Use `COPY` for local files. Keep `ADD` only when archive extraction or remote fetch semantics are intentional.

```dockerfile
COPY app/ /app/
```

