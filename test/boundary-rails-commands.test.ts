import { expect, test } from "bun:test";
import { railsCommands } from "../src/rules/shared/rails-commands.ts";
import { dockerRunCommands } from "../src/rules/shared/docker-image-runs.ts";

test.each([
  ["rails db:migrate", ["rails"]],
  ["bundle exec bin/rails test", ["rails"]],
  ["ruby bin/rails test", ["rails"]],
  ["echo 'rails db:migrate'", []],
  ["printf '%s' 'rspec'", []],
  ["# rake test", []],
  ["rails runner 'db:migrate'", ["rails"]],
] as const)("Rails executable positions: %s", (text, expected) => {
  expect(railsCommands(text).map((command) => command.tool)).toEqual([...expected]);
});

test("Docker option values and server arguments remain separate", () => {
  const [command] = dockerRunCommands(
    "sudo -n docker run --label '--tmpfs' -e NOTE=fsync=off postgres:17 -c work_mem=4MB",
  );
  expect(command?.image).toBe("postgres:17");
  expect(command?.options.get("--label")).toBe("--tmpfs");
  expect(command?.options.has("--tmpfs")).toBe(false);
  expect(command?.arguments).toEqual(["-c", "work_mem=4MB"]);
});
