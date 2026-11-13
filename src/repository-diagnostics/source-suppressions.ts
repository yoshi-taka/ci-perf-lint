import type { Comment } from "oxc-parser";

type SourceRule =
  "no-restricted-imports" | "import/extensions" | "oxc/no-barrel-file" | "jest/no-large-snapshots";

/** Scoped source-audit escape hatches. No configuration evaluation or fixing. */
export function sourceSuppressions(
  comments: readonly Comment[],
  lineAt: (offset: number) => number,
): (rule: SourceRule, offset: number) => boolean {
  const directives = comments.flatMap((comment) => {
    const match =
      /^\s*(?:eslint|oxlint)-(disable-next-line|disable-line|disable|enable)\b(.*)$/s.exec(
        comment.value,
      );
    if (!match) {
      return [];
    }
    const ruleText = match[2]!.split(/\s+--\s*/)[0]!.trim();
    const rules = ruleText ? ruleText.split(",").map((rule) => rule.trim()) : undefined;
    return [
      {
        action: match[1]!,
        rules,
        start: comment.start,
        end: comment.end,
        firstLine: lineAt(comment.start),
        lastLine: lineAt(comment.end),
      },
    ];
  });
  return (rule, offset) => {
    const line = lineAt(offset);
    let disabled = false;
    for (const directive of directives) {
      const aliases =
        rule === "no-restricted-imports"
          ? [rule, `eslint/${rule}`]
          : rule === "import/extensions"
            ? [rule, "import-x/extensions", "eslint-plugin-import/extensions"]
            : rule === "oxc/no-barrel-file"
              ? [rule, "no-barrel-file"]
              : [rule, "eslint-plugin-jest/no-large-snapshots"];
      if (directive.rules && !directive.rules.some((name) => aliases.includes(name))) {
        continue;
      }
      if (directive.action === "disable-next-line" && directive.lastLine + 1 === line) {
        return true;
      }
      if (
        directive.action === "disable-line" &&
        directive.firstLine <= line &&
        line <= directive.lastLine
      ) {
        return true;
      }
      if (directive.end <= offset) {
        if (directive.action === "disable") {
          disabled = true;
        } else if (directive.action === "enable") {
          disabled = false;
        }
      }
    }
    return disabled;
  };
}
