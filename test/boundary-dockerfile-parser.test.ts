import { describe, expect, test } from "bun:test";
import {
  collectDockerfileInstructions,
  parseDockerfileCopyInstruction,
  parseDockerfileAddInstruction,
  parseDockerfileFromInstruction,
} from "../src/repository-diagnostics/dockerfile-instructions.ts";

// Scenarios informed by upstream instruction/directive/JSON/flag/heredoc tests:
// https://github.com/rcjsuen/dockerfile-ast/tree/167771e3c957cd9c30ac3c042103b3d7d12e651a/test
const parse = (source: string) => collectDockerfileInstructions(source.split("\n"));

describe("Dockerfile instruction evidence", () => {
  test("skips BOM, comments and empty CRLF lines while preserving line numbers", () => {
    expect(
      parse("\uFEFF# syntax=docker/dockerfile:1\r\n\r\n # comment\r\n  fRoM alpine:3.22\r\n"),
    ).toEqual([
      {
        keyword: "FROM",
        text: "FROM alpine:3.22",
        argumentsContent: "alpine:3.22",
        flags: [],
        startLine: 4,
      },
    ]);
  });

  test.each(["\n", "\r\n"])(
    "joins continuations and ignores interleaved comments: %j",
    (newline) => {
      const entries = parse(
        [
          "FROM alpine",
          "RUN echo foo\\",
          "bar \\ \t",
          "# comment",
          "",
          " && echo done",
          "COPY . /app",
        ].join(newline),
      );
      expect(entries.map((entry) => [entry.keyword, entry.startLine])).toEqual([
        ["FROM", 1],
        ["RUN", 2],
        ["COPY", 7],
      ]);
      expect(entries[1]!.argumentsContent).toBe("echo foobar  && echo done");
    },
  );

  test("continuations can split the keyword and flags", () => {
    const [entry] = parse("FR\\\nOM --plat\\\nform=linux/amd64 alpine AS base");
    expect(entry?.keyword).toBe("FROM");
    expect(entry?.flags).toEqual([{ name: "platform", value: "linux/amd64" }]);
    expect(parseDockerfileFromInstruction(entry!)).toEqual({ image: "alpine" });
  });

  test("honors escape directives only in the leading directive block", () => {
    const [entry] = parse("# syntax=docker/dockerfile:1\n# EsCaPe = `\nRUN echo foo`\nbar");
    expect(entry?.argumentsContent).toBe("echo foobar");
    for (const prefix of ["\n", "# ordinary comment\n", "FROM alpine\n"]) {
      expect(
        parse(`${prefix}# escape=\u0060\nRUN echo foo\u0060\nCOPY . /app`).at(-1)?.keyword,
      ).toBe("COPY");
    }
  });

  test.each(["# escape=x", "# escape=`\n# escape=\\"])(
    "invalid or duplicate directives are unknown: %s",
    (directive) => {
      expect(parse(`${directive}\nFROM alpine`)).toEqual([]);
    },
  );

  test("escaped escapes do not swallow the following instruction", () => {
    expect(parse("RUN echo foo\\\\\nCOPY . /app").map((entry) => entry.keyword)).toEqual([
      "RUN",
      "COPY",
    ]);
  });

  test("retains shell hashes and quotes, without interpreting shell commands", () => {
    const [entry] = parse('RUN echo "a # b" # comment');
    expect(entry?.argumentsContent).toBe('echo "a # b" # comment');
  });

  test("extracts repeated flags, boolean flags and values containing equals", () => {
    const [entry] = parse('COPY --from=base --chown="user group" --link=false ["a b", "/app/"]');
    expect(entry?.flags).toEqual([
      { name: "from", value: "base" },
      { name: "chown", value: "user group" },
      { name: "link", value: "false" },
    ]);
    expect(parseDockerfileCopyInstruction(entry!)).toEqual({
      sources: ["a b"],
      destination: "/app/",
      linked: false,
    });
    expect(
      parse("RUN --mount=type=cache,target=/x --mount=type=cache,target=/y echo hi")[0]?.flags,
    ).toHaveLength(2);
    expect(parse("COPY --link . /app")[0]?.flags).toEqual([{ name: "link", value: null }]);
  });

  test.each(["RUN", "CMD", "ENTRYPOINT", "SHELL", "VOLUME", "ADD", "COPY"])(
    "decodes JSON strings for %s",
    (keyword) => {
      const values = ['a,]"', "b\\c", "line\nbreak"];
      expect(parse(`${keyword} ${JSON.stringify(values)}`)[0]?.jsonStrings).toEqual(values);
      expect(parse(`${keyword} []`)[0]?.jsonStrings).toEqual([]);
    },
  );

  test.each(['["a", 3]', '["a",]', '["unterminated]', '["a"] extra'])(
    "malformed JSON never becomes COPY evidence: %s",
    (args) => {
      const entries = parse(`COPY ${args}\nRUN echo done`);
      expect(parseDockerfileCopyInstruction(entries[0]!)).toBeUndefined();
      expect(entries[0]!.text).toBe("COPY");
      expect(entries[1]!.keyword).toBe("RUN");
    },
  );

  test("incomplete flags or continuations never become command evidence", () => {
    expect(parse('RUN --mount="unterminated echo hi')[0]?.text).toBe("RUN");
    expect(parse("RUN npm install \\")[0]?.text).toBe("RUN");
    expect(() => parse("\\")).not.toThrow();
  });
});

describe("Dockerfile heredoc boundaries", () => {
  test.each(["EOF", "'EOF'", '"EOF"', "E'OF'", "E\\OF", "E#OF"])(
    "removes delimiter quoting without parsing body as instructions: %s",
    (marker) => {
      const delimiter = marker === "E#OF" ? marker : "EOF";
      const entries = parse(
        `RUN cat <<${marker}\nCOPY . /app\nFROM evil\n${delimiter}\nRUN echo done`,
      );
      expect(entries.map((entry) => [entry.keyword, entry.startLine])).toEqual([
        ["RUN", 1],
        ["RUN", 5],
      ]);
      expect(entries[0]?.argumentsContent).toContain("\nCOPY . /app\nFROM evil\n");
    },
  );

  test("consumes multiple heredocs in order and strips only tabs for <<-", () => {
    const entries = parse(
      "RUN cat <<FIRST <<-'SECOND'\r\nRUN fake\r\nFIRST\r\n\tCOPY fake /app\r\n\tSECOND\r\nFROM alpine\r\n",
    );
    expect(entries.map((entry) => [entry.keyword, entry.startLine])).toEqual([
      ["RUN", 1],
      ["FROM", 6],
    ]);
  });

  test("quoted empty delimiters close at an empty line", () => {
    expect(
      parse("RUN cat <<''\nCOPY fake /app\n\nFROM alpine").map((entry) => [
        entry.keyword,
        entry.startLine,
      ]),
    ).toEqual([
      ["RUN", 1],
      ["FROM", 4],
    ]);
  });

  test.each(["COPY", "ADD", "ONBUILD ADD"])(
    "inline %s file contents are not source paths",
    (keyword) => {
      const entries = parse(`${keyword} <<EOF /app/file\n. /other\nEOF\nRUN echo done`);
      expect(entries).toHaveLength(2);
      expect(parseDockerfileCopyInstruction(entries[0]!)).toBeUndefined();
      expect(parseDockerfileAddInstruction(entries[0]!)).toBeUndefined();
    },
  );

  test.each(['echo "<<EOF"', "echo \\<\\<EOF", "cat <<<EOF", '["echo", "<<EOF"]'])(
    "non-heredoc text does not consume the next instruction: %s",
    (args) => {
      expect(parse(`RUN ${args}\nCOPY . /app`).map((entry) => entry.keyword)).toEqual([
        "RUN",
        "COPY",
      ]);
    },
  );

  test.each(["<<EOF", "<<'EOF", "<<", "<<-EOF"])(
    "unterminated heredocs cannot leak body instructions: %s",
    (header) => {
      const entries = parse(`RUN ${header}\nFROM evil\nCOPY . /app\n EOF`);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.text).toBe("RUN");
    },
  );

  test.each(['RUN --mount="unterminated <<EOF', "COPY --chown='unterminated <<EOF"])(
    "malformed flags do not hide a possible heredoc: %s",
    (header) => {
      expect(parse(`${header}\nFROM evil\nCOPY . /app`)).toHaveLength(1);
    },
  );

  test("a recognized heredoc cannot restore evidence discarded for an invalid flag", () => {
    const entries = parse("RUN --@invalid cat <<EOF\nnpm install\nCOPY . /app\nEOF\nFROM alpine");
    expect(entries.map((entry) => entry.keyword)).toEqual(["RUN", "FROM"]);
    expect(entries[0]?.argumentsContent).toBe("");
    expect(entries[0]?.text).toBe("RUN");
  });
});
