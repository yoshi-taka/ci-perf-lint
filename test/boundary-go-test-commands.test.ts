import { expect, test } from "bun:test";
import { collectGoTestCommands } from "../src/rules/shared/go-test-commands.ts";

test.each([
  "echo 'go test -race ./...'",
  "# go test -p 1 ./...",
  "printf '%s' 'go test ./...'",
  "go test -list . ./...",
  "go test -c ./...",
])("does not invent executed tests: %s", (command) => {
  expect(collectGoTestCommands(command)).toHaveLength(0);
});

test("Go argument ownership", () => {
  const [command] = collectGoTestCommands(
    "env CI=1 go test -p=1 -race=false -run '-race' ./... -args -race",
  );
  expect(command?.flags.get("-p")).toBe("1");
  expect(command?.flags.get("-race")).toBe("false");
  expect(command?.targets).toEqual(["./..."]);
  expect(collectGoTestCommands("go test -p1 ./...")[0]?.flags.get("-p")).toBe("1");
});
