import type { Diagnostic } from "../../types.ts";

export type DiagnosticTransform = (diagnostic: Diagnostic) => Diagnostic;

export interface ComposedDiagnosticTransform extends DiagnosticTransform {
  readonly transforms: readonly DiagnosticTransform[];
  readonly isIdentity: boolean;
}

export type TransformAxis = "score" | "why" | "aiHandoff" | "severity";

export interface TaggedTransform {
  transform: DiagnosticTransform;
  axes: readonly TransformAxis[];
  label: string;
}

export interface TaggedDiagnosticTransform extends DiagnosticTransform {
  readonly transforms: readonly DiagnosticTransform[];
  readonly isIdentity: boolean;
  readonly axes: readonly TransformAxis[];
  readonly labels: readonly string[];
}

export interface DiagnosticTransformMetadata {
  readonly axes: readonly TransformAxis[];
  readonly labels: readonly string[];
}

const diagnosticTransformMetadataKey = Symbol("diagnosticTransformMetadata");

function identityTransformImplementation(diagnostic: Diagnostic): Diagnostic {
  return diagnostic;
}

export const identityDiagnosticTransform: ComposedDiagnosticTransform = Object.assign(
  identityTransformImplementation,
  {
    transforms: [] as const,
    isIdentity: true,
  },
);

function makeTaggedIdentityDiagnosticTransform(): TaggedDiagnosticTransform {
  return Object.assign((diagnostic: Diagnostic) => diagnostic, {
    transforms: [] as const,
    isIdentity: true,
    axes: [] as const,
    labels: [] as const,
  });
}

function isIdentityDiagnosticTransform(transform: DiagnosticTransform): boolean {
  return (transform as ComposedDiagnosticTransform).isIdentity === true;
}

function applyTransformMetadata(
  diagnostic: Diagnostic,
  metadata: DiagnosticTransformMetadata,
): Diagnostic {
  const existing = (
    diagnostic as Diagnostic & { [diagnosticTransformMetadataKey]?: DiagnosticTransformMetadata }
  )[diagnosticTransformMetadataKey];
  if (
    existing &&
    existing.labels.length === metadata.labels.length &&
    existing.axes.length === metadata.axes.length
  ) {
    return diagnostic;
  }
  return Object.defineProperty(diagnostic, diagnosticTransformMetadataKey, {
    value: metadata,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

const globalTransformLabels = new Map<string, Set<string>>();

function diagKey(d: {
  ruleId: string;
  workflow: string;
  location: { path: string; line: number };
}): string {
  return `${d.ruleId}:${d.workflow}:${d.location.path}:${d.location.line}`;
}

export function hasAppliedTransform(diagnostic: Diagnostic, label: string): boolean {
  return globalTransformLabels.get(diagKey(diagnostic))?.has(label) ?? false;
}

export function markTransformApplied(diagnostic: Diagnostic, label: string): Diagnostic {
  const key = diagKey(diagnostic);
  let entry = globalTransformLabels.get(key);
  if (!entry) {
    entry = new Set();
    globalTransformLabels.set(key, entry);
  }
  entry.add(label);
  return diagnostic;
}

export function getAppliedTransformLabels(diagnostic: Diagnostic): readonly string[] {
  const entry = globalTransformLabels.get(diagKey(diagnostic));
  return entry ? [...entry] : [];
}

export function resetTransformTracking(): void {
  globalTransformLabels.clear();
}

export function getDiagnosticTransformMetadata(
  diagnostic: Diagnostic,
): DiagnosticTransformMetadata | undefined {
  return (
    diagnostic as Diagnostic & { [diagnosticTransformMetadataKey]?: DiagnosticTransformMetadata }
  )[diagnosticTransformMetadataKey];
}

function composeTransforms(
  ...transforms: readonly DiagnosticTransform[]
): ComposedDiagnosticTransform {
  const normalized = transforms.filter((transform) => !isIdentityDiagnosticTransform(transform));
  if (normalized.length === 0) {
    return identityDiagnosticTransform;
  }

  const composed = (diagnostic: Diagnostic) => {
    let result = diagnostic;
    for (const fn of normalized) {
      result = fn(result);
    }
    return result;
  };

  return Object.assign(composed, {
    transforms: normalized,
    isIdentity: false,
  });
}

function composeTagged(...taggedTransforms: readonly TaggedTransform[]): TaggedDiagnosticTransform {
  const normalized = taggedTransforms.filter(
    (taggedTransform) => !isIdentityDiagnosticTransform(taggedTransform.transform),
  );

  if (normalized.length === 0) {
    return makeTaggedIdentityDiagnosticTransform();
  }

  const localApplied = new Map<string, Set<string>>();

  const transform = (diagnostic: Diagnostic) => {
    let result = diagnostic;
    for (const taggedTransform of normalized) {
      const key = diagKey(result);
      const applied = localApplied.get(key);
      if (applied?.has(taggedTransform.label)) {
        continue;
      }
      result = taggedTransform.transform(result);
      const resultKey = diagKey(result);
      let entry = localApplied.get(resultKey);
      if (!entry) {
        entry = new Set();
        localApplied.set(resultKey, entry);
      }
      entry.add(taggedTransform.label);
    }
    return applyTransformMetadata(result, {
      axes: normalized.flatMap((taggedTransform) => taggedTransform.axes),
      labels: normalized.map((taggedTransform) => taggedTransform.label),
    });
  };

  return Object.assign(transform, {
    transforms: normalized.map((taggedTransform) => taggedTransform.transform),
    isIdentity: false,
    axes: normalized.flatMap((taggedTransform) => taggedTransform.axes),
    labels: normalized.map((taggedTransform) => taggedTransform.label),
  });
}

export function pipe(...transforms: readonly DiagnosticTransform[]): ComposedDiagnosticTransform {
  return composeTransforms(...transforms);
}

export function taggedPipe(
  ...taggedTransforms: readonly TaggedTransform[]
): TaggedDiagnosticTransform {
  return composeTagged(...taggedTransforms);
}
