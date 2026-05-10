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
  }) as TaggedDiagnosticTransform;
}

function isIdentityDiagnosticTransform(transform: DiagnosticTransform): boolean {
  return (transform as ComposedDiagnosticTransform).isIdentity === true;
}

function applyTransformMetadata(
  diagnostic: Diagnostic,
  metadata: DiagnosticTransformMetadata,
): Diagnostic {
  return Object.defineProperty(diagnostic, diagnosticTransformMetadataKey, {
    value: metadata,
    enumerable: false,
    configurable: false,
    writable: false,
  });
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
  }) as ComposedDiagnosticTransform;
}

function composeTagged(...taggedTransforms: readonly TaggedTransform[]): TaggedDiagnosticTransform {
  const normalized = taggedTransforms.filter(
    (taggedTransform) => !isIdentityDiagnosticTransform(taggedTransform.transform),
  );

  if (normalized.length === 0) {
    return makeTaggedIdentityDiagnosticTransform();
  }

  const transform = (diagnostic: Diagnostic) => {
    let result = diagnostic;
    for (const taggedTransform of normalized) {
      result = taggedTransform.transform(result);
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
  }) as TaggedDiagnosticTransform;
}

export function pipe(...transforms: readonly DiagnosticTransform[]): ComposedDiagnosticTransform {
  return composeTransforms(...transforms);
}

export function taggedPipe(
  ...taggedTransforms: readonly TaggedTransform[]
): TaggedDiagnosticTransform {
  return composeTagged(...taggedTransforms);
}
