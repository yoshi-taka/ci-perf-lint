import type { Confidence, Diagnostic, Severity } from "../../types.ts";
import type { RepairOp } from "../../reification.ts";

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

type FieldMergeStrategy<T> =
  | "first"
  | "last"
  | "replace-with"
  | "concat"
  | "sum"
  | "max"
  | "min"
  | "avg"
  | "coalesce"
  | ((base: T, overrides: readonly T[]) => T);

interface DiagnosticMergeStrategy {
  severity: FieldMergeStrategy<Severity>;
  confidence: FieldMergeStrategy<Confidence>;
  score: FieldMergeStrategy<number>;
  message: FieldMergeStrategy<string>;
  why: FieldMergeStrategy<string>;
  suggestion: FieldMergeStrategy<string>;
  measurementHint: FieldMergeStrategy<string>;
  aiHandoff: FieldMergeStrategy<string>;
  location: FieldMergeStrategy<{ path: string; line: number; column: number }>;
  repair?: FieldMergeStrategy<RepairOp | undefined>;
}

const defaultMergeStrategy: DiagnosticMergeStrategy = {
  severity: "first",
  confidence: "first",
  score: "avg",
  message: "first",
  why: "first",
  suggestion: "first",
  measurementHint: "first",
  aiHandoff: "first",
  location: "last",
};

function applyMergeStrategy<T>(
  base: T,
  overrides: readonly T[],
  strategy: FieldMergeStrategy<T>,
): T {
  if (overrides.length === 0) {
    return base;
  }

  switch (strategy) {
    case "first":
      return base;
    case "last":
    case "replace-with":
      return overrides[overrides.length - 1]!;
    case "concat": {
      const all = [base, ...overrides].filter((v) => v !== "" && v !== undefined);
      return all.join(" ") as unknown as T;
    }
    case "sum": {
      const nums = [base as number, ...(overrides as unknown as number[])];
      return nums.reduce((a, b) => a + b, 0) as unknown as T;
    }
    case "max": {
      const nums = [base as number, ...(overrides as unknown as number[])];
      return Math.max(...nums) as unknown as T;
    }
    case "min": {
      const nums = [base as number, ...(overrides as unknown as number[])];
      return Math.min(...nums) as unknown as T;
    }
    case "avg": {
      const nums = [base as number, ...(overrides as unknown as number[])];
      return (nums.reduce((a, b) => a + b, 0) / nums.length) as unknown as T;
    }
    case "coalesce": {
      const all = [base, ...overrides].filter((v) => v !== undefined && v !== null);
      return (all[0] ?? (base as unknown)) as T;
    }
    default:
      return (strategy as (base: T, overrides: readonly T[]) => T)(base, overrides);
  }
}

class DiagnosticMerger {
  constructor(private readonly strategy: Partial<DiagnosticMergeStrategy> = {}) {
    this.strategy = { ...defaultMergeStrategy, ...strategy };
  }

  merge(base: Diagnostic, ...overrides: Diagnostic[]): Diagnostic {
    if (overrides.length === 0) {
      return base;
    }

    const s = this.strategy;

    const severityValues = overrides.map((o) => o.severity);
    const confidenceValues = overrides.map((o) => o.confidence);
    const scoreValues = overrides.map((o) => o.score);
    const messageValues = overrides.map((o) => o.message);
    const whyValues = overrides.map((o) => o.why);
    const suggestionValues = overrides.map((o) => o.suggestion);
    const measurementHintValues = overrides.map((o) => o.measurementHint);
    const aiHandoffValues = overrides.map((o) => o.aiHandoff);
    const locationValues = overrides.map((o) => o.location);
    const repairValues = overrides.map((o) => o.repair);

    return {
      ruleId: base.ruleId,
      docsPath: base.docsPath,
      workflow: base.workflow,
      scope: base.scope,
      source: base.source,
      severity: applyMergeStrategy(base.severity, severityValues, s.severity!),
      confidence: applyMergeStrategy(base.confidence, confidenceValues, s.confidence!),
      score: applyMergeStrategy(base.score, scoreValues, s.score!),
      message: applyMergeStrategy(base.message, messageValues, s.message!),
      why: applyMergeStrategy(base.why, whyValues, s.why!),
      suggestion: applyMergeStrategy(base.suggestion, suggestionValues, s.suggestion!),
      measurementHint: applyMergeStrategy(
        base.measurementHint,
        measurementHintValues,
        s.measurementHint!,
      ),
      aiHandoff: applyMergeStrategy(base.aiHandoff, aiHandoffValues, s.aiHandoff!),
      location: applyMergeStrategy(base.location, locationValues, s.location!),
      repair: applyMergeStrategy(base.repair ?? undefined, repairValues, s.repair ?? "last"),
    };
  }
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
