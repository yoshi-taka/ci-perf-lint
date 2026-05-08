const ESC = "\x1b";

const yellowDim = `${ESC}[93m${ESC}[2m`;
const reset = `${ESC}[0m`;

const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";

export function stderrWarn(message: string): void {
  if (process.stderr.isTTY && !noColor) {
    process.stderr.write(`${yellowDim}${message}${reset}`);
  } else {
    process.stderr.write(message);
  }
}
