import type { Diagnostic } from "../../types.ts";

type DiagnosticTransform = (diagnostic: Diagnostic) => Diagnostic;

export const compose =
  (...transforms: DiagnosticTransform[]): DiagnosticTransform =>
  (diagnostic) => {
    let result = diagnostic;
    for (const fn of transforms) {
      result = fn(result);
    }
    return result;
  };
