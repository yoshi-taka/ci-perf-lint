import { LineCounter, isMap, isSeq, parseDocument, type ParsedDocument } from "./yaml.ts";
import { convertDocument } from "./yaml-document.ts";
import { resolveYamlAst, YamlReferenceError } from "./yaml-resolved-ast.ts";
import type { CiKind } from "./ci-types.ts";

const mergePolicy: Record<CiKind, boolean> = {
  "github-actions": false,
  buildkite: true,
  "gitlab-ci": true,
  circleci: true,
};

/** Keep CI policy separate from the generic YAML 1.2 syntax parser.
 * GitLab/CircleCI/Buildkite accept map merges; GitHub Actions accepts aliases
 * but not merge overrides. Depot follows GitHub Actions via that same kind.
 */
export function parseCiYaml(
  source: string,
  kind: CiKind,
  lineCounter = new LineCounter(),
): ParsedDocument {
  const merge = mergePolicy[kind];
  const document = parseDocument(source, { lineCounter, merge });
  if (document.errors.length || !document.contents) {
    return document;
  }
  // No references means the syntax tree is already resolved. Aliases require '*';
  // merge directives require '<<' or an explicit tag ('!'). Avoid cloning normal CI.
  if (!source.includes("*") && !source.includes("<<") && !source.includes("!")) {
    return document;
  }
  try {
    const contents = resolveYamlAst(document.contents, { merge });
    return {
      ...document,
      contents,
      get: (key, keepScalar) =>
        isMap(contents) || isSeq(contents) ? contents.get(key, keepScalar) : undefined,
      toJS: (options) => convertDocument(contents, options),
      toJSON: (arg) => convertDocument(contents, {}, true, arg),
    };
  } catch (error) {
    if (!(error instanceof YamlReferenceError)) {
      throw error;
    }
    const position = lineCounter.linePos(error.offset);
    const issue = Object.assign(
      new Error(`${error.message} at line ${position.line}, column ${position.col}`),
      {
        code: "BAD_REFERENCE",
        pos: [error.offset, error.offset + 1] as [number, number],
      },
    );
    return { ...document, errors: [...document.errors, issue] };
  }
}
