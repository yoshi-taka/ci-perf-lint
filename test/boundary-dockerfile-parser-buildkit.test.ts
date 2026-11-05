import { describe, expect, test } from "bun:test";
import { collectDockerfileInstructions } from "../src/repository-diagnostics/dockerfile-parser.ts";

// Independently minimized scenarios, not copied Go code or AST snapshots.
// Reference: moby/buildkit (Go), pinned to d2de46024181d568265fde40ea4bbe6694417b46.
// frontend/dockerfile/parser/{parser_heredoc_test.go,parser_test.go,split_command.go}
// https://github.com/moby/buildkit/tree/d2de46024181d568265fde40ea4bbe6694417b46/frontend/dockerfile/parser
// Boundary/flag expectations also checked against that Go parser in a temporary
// harness. The normal test suite needs neither Go, Docker, nor network access.
const parse = (source: string) => collectDockerfileInstructions(source.split("\n"));
const locations = (source: string) =>
  parse(source).map(({ keyword, startLine }) => [keyword, startLine]);

describe("BuildKit Go parser reference scenarios", () => {
  test.each([
    ["RUN 3<<END", "END"],
    ["RUN <<EO'F'", "EOF"],
    [String.raw`RUN <<eo\'f`, "eo'f"],
    [String.raw`RUN <<'e'o\'f`, "eo'f"],
    ["RUN <<'two words'", "two words"],
    ["RUN <<$END", "$END"],
    ["RUN <<  END", "END"],
    ["RUN <<- END", "END"],
    ["RUN << -END", "-END"],
    ["RUN <<END > /tmp/output", "END"],
    ["RUN --mount=type=cache,target=/cache <<END", "END"],
    ["COPY <<file.txt /app/file.txt", "file.txt"],
    ["ONBUILD RUN <<END", "END"],
    ["RUN echo hello # <<END", "END"],
    [String.raw`RUN <<"\q"`, String.raw`\q`],
  ])("heredoc boundary: %s", (header, delimiter) => {
    const source = `${header}\nFROM literal-not-a-stage\n${delimiter}\nFROM alpine:3.22`;
    expect(locations(source)).toEqual([
      [header.split(" ")[0], 1],
      ["FROM", 4],
    ]);
    expect(parse(source)[0]?.argumentsContent).toContain("\nFROM literal-not-a-stage\n");
  });

  test("multiple COPY heredocs terminate sequentially, not at another delimiter's text", () => {
    const source = "COPY <<FIRST <<SECOND /app\nSECOND\nFIRST\nFIRST\nSECOND\nFROM alpine:3.22";
    expect(locations(source)).toEqual([
      ["COPY", 1],
      ["FROM", 6],
    ]);
  });

  test.each([
    "RUN echo x<<NOT_A_DOC",
    "RUN echo $((8<<1))",
    "RUN echo '<<NOT_A_DOC'",
    'RUN ["<<END"]',
    "RUN [\"<<'END'\"]",
    "USER <<NOT_A_DOC",
    "ENV EXAMPLE=<<NOT_A_DOC",
  ])("does not invent heredocs for %s", (header) => {
    expect(locations(`${header}\nFROM alpine:3.22`)).toEqual([
      [header.split(" ")[0], 1],
      ["FROM", 2],
    ]);
  });

  test.each(["\\", "`"])(
    "builder flags honor the Docker escape token, including inside quotes: %s",
    (escape) => {
      for (const value of [
        `user${escape} group`,
        `"user${escape} group"`,
        `'user${escape} group'`,
      ]) {
        const [entry] = parse(`# escape=${escape}\nCOPY --chown=${value} . /app`);
        expect(entry?.flags).toEqual([{ name: "chown", value: "user group" }]);
        expect(entry?.argumentsContent).toBe(". /app");
      }
    },
  );

  test("a standalone -- ends builder flags instead of becoming a malformed flag", () => {
    const [entry] = parse("RUN --mount=type=cache,target=/cache -- echo --literal=value");
    expect(entry?.flags).toEqual([{ name: "mount", value: "type=cache,target=/cache" }]);
    expect(entry?.argumentsContent).toBe("echo --literal=value");
  });
});
