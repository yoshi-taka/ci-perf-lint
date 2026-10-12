# Dockerfile local ADD without clear need

`ADD` has extra behavior for remote URLs and archive extraction. For ordinary local files and directories, `COPY` is more explicit and avoids accidentally doing extra work in the Docker build.

Use `COPY` for local files. Keep `ADD` only when archive extraction or remote fetch semantics are intentional.

The scanner checks shell-style and JSON-form `ADD`, including `ONBUILD ADD`. An instruction is reported if any source is an ordinary local file or directory, including local ZIP files: **ADD does not auto-extract ZIP**. Flags such as `--chown` and `--chmod` do not by themselves justify using ADD.

HTTP(S), Git and SSH URLs (including `git@host:path`), unresolved source variables, and possible tar archive inputs are excluded. Filename candidates include `.tar`, `.gz`, `.bz2`, `.xz`, `.zst`, `.tgz`, `.tbz`, `.tbz2`, `.txz` and `.tzst`. Docker identifies tar archives by content, not extension; this rule uses filename evidence and does not validate or decompress inputs. One finding per Dockerfile points to the first affected instruction.

For mixed local and remote/archive sources, split the instruction only when needed and preserve the remote fetch or extraction behavior; do not replace the entire instruction blindly.

```dockerfile
COPY app/ /app/
```
