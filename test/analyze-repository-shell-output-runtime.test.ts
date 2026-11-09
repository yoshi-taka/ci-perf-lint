import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const loadRule = "docker-build-load-true-unnecessary";
const dbRule = "db-io-reduce";
const railsRule = "rails-db-schema-load-over-migrate";
const milestoneRule = "prefer-rails-performance-milestone";

async function scan(
  steps: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
  ruby = false,
) {
  const cwd = await tempDirs.create("apl-shell-runtime-");
  await writeRepositoryFiles(cwd, {
    ...(ruby ? { Gemfile: "source 'https://rubygems.org'\ngem 'rails', '~> 7.1.5'\n" } : {}),
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on: "push",
      jobs: {
        check: {
          "runs-on": "ubuntu-latest",
          ...extra,
          steps,
        },
      },
    }),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.scope !== "repository");
}

const loadedImage = { uses: "docker/build-push-action@v6", with: { load: true, tags: "app:test" } };

test.each([
  "echo 'docker run app:test'",
  "printf '%s' 'app:test ./bin/check.sh'",
  "# docker run app:test",
  "echo '${{ steps.image.outputs.digest }}'",
  "grep app:test Dockerfile",
])("displayed image consumption does not exempt load: %s", async (run) => {
  const findings = await scan([loadedImage, { run }]);
  expect(findings.some((finding) => finding.ruleId === loadRule)).toBe(true);
});

test.each([
  "docker run app:test",
  "./bin/run-tests-in-docker.sh",
  "make test",
  "npm run test:image",
  "uv run tests.py",
  'echo "$(docker run app:test)"',
  "scanner app:test",
])("actual or opaque consumers retain the load guard: %s", async (run) => {
  const findings = await scan([loadedImage, { run }]);
  expect(findings.some((finding) => finding.ruleId === loadRule)).toBe(false);
});

test("an opaque action or custom shell cannot prove the image unused", async () => {
  const action = await scan([loadedImage, { uses: "./.github/actions/test" }]);
  expect(action.some((finding) => finding.ruleId === loadRule)).toBe(false);
  const shell = await scan([loadedImage, { run: "check", shell: "custom-shell {0}" }]);
  expect(shell.some((finding) => finding.ruleId === loadRule)).toBe(false);
});

test("a script before the build is not a subsequent image consumer", async () => {
  const findings = await scan([{ run: "./scripts/prepare.sh" }, loadedImage, { run: "echo done" }]);
  expect(findings.some((finding) => finding.ruleId === loadRule)).toBe(true);
});

test.each([
  ["docker run -d -e POSTGRES_PASSWORD=test postgres:17", true],
  ["echo 'docker run -d postgres:17'", false],
  ["printf '%s' 'docker run -d mysql:8'", false],
  ["# docker run -d postgres:17\necho done", false],
  ['echo "$(docker run -d postgres:17)"', true],
  ["docker run --label database=postgres alpine", false],
  ["docker run --name postgres alpine", false],
  ["docker run --entrypoint echo postgres:17", false],
  ["docker run docker.io/library/postgres:17", true],
  ["docker run postgres@sha256:deadbeef", true],
  ["docker run postgres:17 psql --version", false],
  ["docker run postgres:17 sh -c 'echo fsync=off'", false],
  ["docker run -e NOTE=fsync=off postgres:17", true],
  ["docker run --label '--tmpfs' postgres:17", true],
  ["docker run --tmpfs /var/lib/postgresql/data postgres:17", false],
  ["docker run postgres:17 -c fsync=off", false],
  ["docker run postgres:17\necho '-c fsync=off --tmpfs /data'", true],
  ["docker run mysql:8 --innodb_flush_log_at_trx_commit=2\ndocker run postgres:17", true],
] as const)(
  "DB evidence and optimization belong to their invocation: %s",
  async (run, expected) => {
    const findings = await scan([{ name: "Run", run }]);
    expect(findings.some((finding) => finding.ruleId === dbRule)).toBe(expected);
  },
);

test.each([
  ["docker compose up -d postgres", true],
  ["docker compose -f compose.yml up -d mysql", true],
  ["echo 'docker compose up postgres'", false],
  ["docker compose up web\necho postgres", false],
  ["docker compose up postgres\necho --tmpfs", true],
] as const)("Compose display text cannot create DB/config evidence: %s", async (run, expected) => {
  const findings = await scan([{ run }]);
  expect(findings.some((finding) => finding.ruleId === dbRule)).toBe(expected);
});

const dbService = {
  services: { postgres: { image: "postgres:17", env: { POSTGRES_PASSWORD: "test" } } },
};
test.each([
  ["bundle exec rails db:migrate", true],
  ["bin/rails db:migrate", true],
  ["echo 'bundle exec rails db:migrate'", false],
  ["printf '%s' 'rails db:migrate'", false],
  ["# rails db:migrate\necho done", false],
  ['echo "$(rails db:migrate)"', true],
  ["rails db:migrate\necho db:migrate:redo", true],
  ["rails db:migrate:redo\nrails db:migrate", true],
  ["rails db:migrate:redo", false],
] as const)("Rails migration tasks use command positions: %s", async (run, expected) => {
  const findings = await scan([{ run }, { run: "bundle exec rspec" }], dbService, true);
  expect(findings.some((finding) => finding.ruleId === railsRule)).toBe(expected);
});

test.each(["echo 'bundle exec rspec'", "printf '%s' 'rails test'", "# rails test"])(
  "printed tests do not establish a Rails test context: %s",
  async (run) => {
    const findings = await scan(
      [{ run: "rails db:migrate" }, { name: "rails test", run }],
      dbService,
      true,
    );
    expect(
      findings.some((finding) => finding.ruleId === railsRule || finding.ruleId === milestoneRule),
    ).toBe(false);
  },
);

test("explicit Rails test environment remains a context signal", async () => {
  const findings = await scan(
    [{ run: "rails db:migrate" }],
    { ...dbService, env: { RAILS_ENV: "test" } },
    true,
  );
  expect(findings.some((finding) => finding.ruleId === railsRule)).toBe(true);
});

test("explicit migration intent remains an exemption", async () => {
  const findings = await scan(
    [{ name: "Verify migration compatibility", run: "rails db:migrate" }, { run: "rspec" }],
    dbService,
    true,
  );
  expect(findings.some((finding) => finding.ruleId === railsRule)).toBe(false);
});

test.each(["rspec", "bundle exec rspec", "bin/rails test", "rake assets:precompile"])(
  "real Rails performance workloads remain detected: %s",
  async (run) => {
    const findings = await scan([{ run }], {}, true);
    expect(findings.some((finding) => finding.ruleId === milestoneRule)).toBe(true);
  },
);
