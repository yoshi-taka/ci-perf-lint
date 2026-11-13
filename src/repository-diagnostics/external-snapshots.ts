import { loadOxcParser } from "./oxc-parser.ts";
import { exceedsSourceLimit, MAX_EXTERNAL_SNAPSHOT_LINES } from "./source-size-policy.ts";

/** Read generated snapshot assignments as syntax, never eval templates or target code. */
export async function findExternalSnapshots(source: string): Promise<
  | {
      offset: number;
      name: string;
      lineCount: number;
    }[]
  | undefined
> {
  const { parseSync } = await loadOxcParser();
  const parsed = parseSync("snapshot.js", source);
  if (parsed.errors.length) {
    return undefined;
  }
  const snapshots: { offset: number; name: string; lineCount: number }[] = [];
  for (const statement of parsed.program.body) {
    if (
      statement.type !== "ExpressionStatement" ||
      statement.expression.type !== "AssignmentExpression"
    ) {
      continue;
    }
    const { left, right, operator } = statement.expression;
    if (
      operator !== "=" ||
      left.type !== "MemberExpression" ||
      !left.computed ||
      left.object.type !== "Identifier" ||
      left.object.name !== "exports" ||
      left.property.type !== "TemplateLiteral" ||
      left.property.expressions.length ||
      right.type !== "TemplateLiteral" ||
      right.expressions.length
    ) {
      continue;
    }
    const name = left.property.quasis[0]?.value.cooked;
    const body = right.quasis[0]?.value.cooked;
    if (name === null || name === undefined || body === null || body === undefined) {
      continue;
    }
    const lineCount = body.split(/\r\n|\r|\n/).length;
    if (exceedsSourceLimit(lineCount, MAX_EXTERNAL_SNAPSHOT_LINES)) {
      snapshots.push({ offset: statement.start, name, lineCount });
    }
  }
  return snapshots;
}
