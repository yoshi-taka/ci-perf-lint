# rails-db-schema-load-over-migrate

Detects GitHub Actions jobs that initialize an ephemeral Rails test database by
replaying all migrations with `rails db:migrate`, and recommends
`rails db:schema:load` instead.

## Why This Matters

In CI, test databases are ephemeral—they are created fresh for each run and
discarded afterward. Running `db:migrate` on every CI run executes every
migration in sequence, which can take significantly longer than loading the
current schema directly via `db:schema:load` (or `db:structure:load` for SQL
schema dumps).

For large Rails applications with hundreds of migrations, the difference can be
minutes per CI run.

## Detection

The rule fires when a job meets **all** of the following:

1. **Rails/Ruby job**: uses `ruby/setup-ruby`, or runs `bundle install`,
   `bundle exec`, `rails`, `rake`, `rspec`, or `bin/rails`.
2. **Ephemeral database**: declares a `services` entry for PostgreSQL, MySQL,
   or MariaDB.
3. **Test context**: sets `RAILS_ENV=test` or `RACK_ENV=test`, or runs
   `rails test`, `rake test`, `rspec`, or `bundle exec rspec`.
4. **Uses `db:migrate`**: runs `rails db:migrate`, `bin/rails db:migrate`,
   `bundle exec rails db:migrate`, `rake db:migrate`, or
   `bundle exec rake db:migrate`.

### Not Triggered When

- The job or workflow name suggests migration verification intent (e.g.
  contains `migration`, `schema check`, `rollback`, `upgrade`,
  `compatibility`).
- The command is a migration-variation such as `db:migrate:redo`,
  `db:migrate:down`, `db:migrate:up`, `db:rollback`, `db:forward`, or
  `db:abort_if_pending_migrations`.

## Resolution

Replace the migration step:

```diff
- bundle exec rails db:migrate
+ bundle exec rails db:schema:load
```

If your project uses `db/structure.sql` instead of `db/schema.rb`:

```diff
- bundle exec rails db:migrate
+ bundle exec rails db:structure:load
```

Keep `db:migrate` only in jobs that intentionally test migration correctness,
such as a "schema check" or "migration verification" workflow.

## Severity

- **High** — when ephemeral DB service, test context, and `db:migrate` are all
  detected.
