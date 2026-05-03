# `db-io-reduce`

Database service containers and ad-hoc `docker run` commands in CI write to disk by default. On GitHub Actions hosted runners, this causes unnecessary I/O overhead that can significantly slow down test suites.

Optimise by either:

1. **Using `--tmpfs`** to mount the database data directory as an in-memory filesystem.
2. **Configuring the database to reduce disk I/O** (disk flushes are a major source of I/O overhead on CI runners):
   - **MySQL**: Set `innodb_flush_log_at_trx_commit=2`.
   - **PostgreSQL**: Set `fsync=off` (acceptable for ephemeral CI environments).

## Scope

This rule checks three patterns:

- **Service containers**: `jobs.<id>.services.*.image` matching MySQL or PostgreSQL.
- **Direct `docker run`**: Steps that call `docker run` with a MySQL or PostgreSQL image.
- **`docker compose`**: Steps that call `docker compose up/start/run` when the step name or command mentions MySQL/PostgreSQL.

## Examples

### Not optimal

```yaml
services:
  mysql:
    image: mysql:8
    env:
      MYSQL_ALLOW_EMPTY_PASSWORD: yes
```

```yaml
steps:
  - run: docker run -d -p 3306:3306 mysql:8
```

### Optimal (tmpfs)

```yaml
services:
  mysql:
    image: mysql:8
    options: --tmpfs /var/lib/mysql
    env:
      MYSQL_ALLOW_EMPTY_PASSWORD: yes
```

### Optimal (config flag)

```yaml
services:
  postgres:
    image: postgres:14
    env:
      POSTGRES_PASSWORD: password
      PGOPTIONS: "-c fsync=off"
```
