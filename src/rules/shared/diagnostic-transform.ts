import type { Diagnostic } from "../../types.ts";

export type DiagnosticTransform = (diagnostic: Diagnostic) => Diagnostic;

const compose =
  (...transforms: DiagnosticTransform[]): DiagnosticTransform =>
  (diagnostic) => {
    let result = diagnostic;
    for (const fn of transforms) {
      result = fn(result);
    }
    return result;
  };

export function pipe(...transforms: DiagnosticTransform[]): DiagnosticTransform {
  return compose(...transforms);
}
