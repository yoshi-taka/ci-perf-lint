import type { Confidence } from "../../types.ts";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const PARAMETER = /<<\s*parameters\.([\w-]+)\s*>>/g;

function resolveValue(
  value: JsonValue,
  parameters: ReadonlyMap<string, string>,
): JsonValue | undefined {
  if (typeof value === "string") {
    const matches = [...value.matchAll(PARAMETER)];
    if (matches.some((match) => !parameters.has(match[1]!))) {
      return undefined;
    }
    return value.replace(PARAMETER, (_match, name: string) => parameters.get(name) ?? "");
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => resolveValue(item, parameters));
    return items.some((item) => item === undefined) ? undefined : (items as JsonValue[]);
  }
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = resolveValue(item, parameters);
      if (resolved === undefined) {
        return undefined;
      }
      result[key] = resolved;
    }
    return result;
  }
  return value;
}

function truthy(value: JsonValue | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return Boolean(String(value).length > 0);
  }
  return undefined;
}

function equalValues(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean | undefined {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesPattern(
  value: JsonValue | undefined,
  pattern: JsonValue | undefined,
): boolean | undefined {
  if (value === undefined || pattern === undefined) {
    return undefined;
  }
  if (typeof pattern !== "string" || typeof value !== "string") {
    return undefined;
  }
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return undefined;
  }
}

function evalNode(value: JsonValue, parameters: ReadonlyMap<string, string>): boolean | undefined {
  const resolved = resolveValue(value, parameters);
  if (resolved === undefined) {
    return undefined;
  }
  if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
    for (const [operator, operand] of Object.entries(resolved)) {
      if (operator === "and" && Array.isArray(operand)) {
        const results = operand.map((item) => evalNode(item, parameters));
        if (results.some((result) => result === false)) {
          return false;
        }
        return results.some((result) => result === undefined) ? undefined : true;
      }
      if (operator === "or" && Array.isArray(operand)) {
        const results = operand.map((item) => evalNode(item, parameters));
        if (results.some((result) => result === true)) {
          return true;
        }
        return results.some((result) => result === undefined) ? undefined : false;
      }
      if (operator === "not") {
        const result = evalNode(operand, parameters);
        return result === undefined ? undefined : !result;
      }
      if (operator === "equal" && Array.isArray(operand) && operand.length === 2) {
        return equalValues(
          resolveValue(operand[0]!, parameters),
          resolveValue(operand[1]!, parameters),
        );
      }
      if (operator === "matches") {
        if (Array.isArray(operand) && operand.length === 2) {
          return matchesPattern(
            resolveValue(operand[0]!, parameters),
            resolveValue(operand[1]!, parameters),
          );
        }
        if (operand && typeof operand === "object" && !Array.isArray(operand)) {
          return matchesPattern(operand.value, operand.pattern);
        }
      }
      return undefined;
    }
  }
  return truthy(resolved);
}

/** Statically evaluate a CircleCI when/unless condition when all inputs are known. */
export function evaluateCircleCiCondition(
  condition: JsonValue | undefined,
  parameters: ReadonlyMap<string, string>,
): boolean | undefined {
  if (condition === undefined) {
    return undefined;
  }
  return evalNode(condition, parameters);
}

export function downgradeCircleCiConfidence(confidence: Confidence): Confidence {
  if (confidence === "high") {
    return "medium";
  }
  return "low";
}
