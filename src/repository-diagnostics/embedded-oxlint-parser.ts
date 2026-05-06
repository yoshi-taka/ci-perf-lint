const OXLINE_RE = /^(.+?):(\d+):(\d+):\s*(.+?)\s*\[(\w+)\/([^\]]+)\]/;

export interface OxlintDiagnostic {
  filename: string;
  line: number;
  column: number;
  message: string;
  severity: string;
  code: string;
}

export function parseOxlintLine(line: string): OxlintDiagnostic | undefined {
  const match = OXLINE_RE.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    filename: match[1]!,
    line: Number(match[2]!),
    column: Number(match[3]!),
    message: match[4]!,
    severity: match[5]!,
    code: match[6]!,
  };
}
