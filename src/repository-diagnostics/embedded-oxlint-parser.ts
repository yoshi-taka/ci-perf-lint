const OXLINE_RE = /^(.+?):(\d+):(\d+):\s*(.+?)\s*\[(\w+)\/([^\]]+)\]/;
const OXLINE_ERR_RE = /^(.+?):(\d+):(\d+):\s*(.+?)\s*\[(\w+)\]$/;

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
  if (match) {
    return {
      filename: match[1]!,
      line: Number(match[2]!),
      column: Number(match[3]!),
      message: match[4]!,
      severity: match[5]!,
      code: match[6]!,
    };
  }

  const errMatch = OXLINE_ERR_RE.exec(line);
  if (errMatch) {
    return {
      filename: errMatch[1]!,
      line: Number(errMatch[2]!),
      column: Number(errMatch[3]!),
      message: errMatch[4]!,
      severity: errMatch[5]!,
      code: `oxc(${errMatch[5]!.toLowerCase()})`,
    };
  }

  return undefined;
}
