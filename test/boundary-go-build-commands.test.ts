import { expect, test } from "bun:test";
import { collectGoBuildCommands } from "../src/rules/shared/go-build-commands.ts";
import { goBuildOccurrenceCountInRun } from "../src/rules/shared/job-step-analysis.ts";

test.each([
  ["go build ./cmd/a", [["./cmd/a"]]],
  ["go build", [[]]],
  ["go build ./cmd/a && go build ./cmd/b", [["./cmd/a"], ["./cmd/b"]]],
  ["go build ./cmd/a\ngo build ./cmd/b", [["./cmd/a"], ["./cmd/b"]]],
  ["go build ./cmd/a ./cmd/b", [["./cmd/a", "./cmd/b"]]],
  ["go build fmt net/http", [["fmt", "net/http"]]],
  ["go build -o ./bin/a ./cmd/a", [["./cmd/a"]]],
  ["go build -o=./bin/a ./cmd/a", [["./cmd/a"]]],
  ['go build -ldflags "./example go build ./example2" ./cmd/a', [["./cmd/a"]]],
  ["go build -tags ./tag ./cmd/a", [["./cmd/a"]]],
  ["go build -modfile ./go.mod ./cmd/a", [["./cmd/a"]]],
  ["go build ./cmd/a && echo ./cmd/b", [["./cmd/a"]]],
  ["go build ./cmd/a # go build ./cmd/b", [["./cmd/a"]]],
  ["go build \\\n ./cmd/a \\\n ./cmd/b", [["./cmd/a", "./cmd/b"]]],
  ["env GOOS=linux go build ./cmd/a", [["./cmd/a"]]],
  ["GOOS=linux go build ./cmd/a", [["./cmd/a"]]],
  ["/usr/local/go/bin/go build ./cmd/a", [["./cmd/a"]]],
  ["go -C app build ./cmd/a", [["./cmd/a"]]],
  ["go -C=app build ./cmd/a", [["./cmd/a"]]],
  ["go build -race -trimpath -buildvcs=false ./cmd/a", [["./cmd/a"]]],
  ["echo 'go build ./cmd/a'", []],
  ["printf '%s' 'go build ./cmd/a'", []],
  ["# go build ./cmd/a", []],
  ["cat <<EOF\ngo build ./cmd/a\nEOF", []],
  ["sh -c 'go build ./cmd/a'", []],
  ["go help build", []],
  ["go build -n ./cmd/a", []],
  ["go build -h", []],
  ["go build $PACKAGES", []],
  ["echo $(go build ./cmd/a) $(go build ./cmd/b)", []],
  ["go build -o", []],
  ["go build -unknown ./cmd/a", []],
  ["if true; then go build ./cmd/a; fi", []],
] as const)("counts executable builds and their own targets: %s", (text, expected) => {
  expect(collectGoBuildCommands(text).map((command) => command.targets)).toEqual(
    expected.map((targets) => [...targets]),
  );
  expect(goBuildOccurrenceCountInRun(text)).toBe(expected.length);
});
