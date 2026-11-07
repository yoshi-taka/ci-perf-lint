import { expect } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";

// A graph projection checks reference identity, not just equal expanded values.
function graph(value: unknown, seen = new Map<object | symbol, number>()): unknown {
  if (typeof value === "symbol") {
    if (seen.has(value)) {
      return { reference: seen.get(value) };
    }
    const id = seen.size;
    seen.set(value, id);
    return { id, symbol: value.description };
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return { reference: seen.get(value) };
  }
  const id = seen.size;
  seen.set(value, id);
  if (value instanceof Date) {
    return { id, date: value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { id, bytes: [...value] };
  }
  if (Array.isArray(value)) {
    return { id, array: value.map((item) => graph(item, seen)) };
  }
  if (value instanceof Map) {
    return { id, map: [...value].map(([key, item]) => [graph(key, seen), graph(item, seen)]) };
  }
  if (value instanceof Set) {
    return { id, set: [...value].map((item) => graph(item, seen)) };
  }
  return { id, object: Object.entries(value).map(([key, item]) => [key, graph(item, seen)]) };
}

export function captureYamlWarnings<T>(run: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const emitWarning = Object.getOwnPropertyDescriptor(process, "emitWarning");
  if (!emitWarning) {
    throw new Error("Expected process.emitWarning descriptor");
  }
  process.emitWarning = (warning: string | Error): void => {
    warnings.push(warning instanceof Error ? warning.message : warning);
  };
  try {
    return { result: run(), warnings };
  } finally {
    Object.defineProperty(process, "emitWarning", emitWarning);
  }
}

function outcome(run: () => unknown): unknown {
  const { result, warnings } = captureYamlWarnings(() => {
    try {
      return { value: graph(run()) };
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return { error: error.name, message: error.message };
    }
  });
  return { ...result, warnings };
}

export function compareDocumentConversion(source: string, limits: readonly number[] = [100]): void {
  const actual = parseDocument(source);
  const expected = referenceParse(source);
  if (expected.errors.length > 0 || expected.warnings.length > 0) {
    // Invalid-input recovery is out of the compatibility contract: diagnostics
    // must be present, but recovered ASTs and extra diagnostics may differ.
    expect(actual.errors.length + actual.warnings.length).toBeGreaterThan(0);
    return;
  }
  expect(actual.errors).toEqual([]);
  expect(actual.warnings).toEqual([]);
  for (const mapAsMap of [false, true]) {
    for (const maxAliasCount of limits) {
      expect(outcome(() => actual.toJS({ maxAliasCount, mapAsMap }))).toEqual(
        outcome(() => expected.toJS({ maxAliasCount, mapAsMap })),
      );
    }
  }
  expect(outcome(() => actual.toJSON())).toEqual(outcome(() => expected.toJSON()));
  expect(outcome(() => actual.contents?.toJSON())).toEqual(
    outcome(() => expected.contents?.toJSON()),
  );
}
