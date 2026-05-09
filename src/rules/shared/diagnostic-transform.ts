import type { Diagnostic } from "../../types.ts";

export type DiagnosticTransform = (diagnostic: Diagnostic) => Diagnostic;

export const compose =
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

export function applyIf(
  condition: boolean,
  transform: DiagnosticTransform,
): DiagnosticTransform {
  return condition ? transform : (d) => d;
}

export function applyWhen<T>(
  value: T | undefined,
  factory: (value: T) => DiagnosticTransform,
): DiagnosticTransform {
  return value !== undefined ? factory(value) : (d) => d;
}
