import type { Diagnostic, SourceLocation } from "./types.ts";

export interface WorkflowDiagnosticSource {
  readonly kind: "workflow";
  readonly workflowPath: string;
  readonly location: SourceLocation;
}

export interface RepositoryDiagnosticSource {
  readonly kind: "repository";
  readonly workflowPath: string;
  readonly location: SourceLocation;
}

export interface CompositeDiagnosticSource<
  Sources extends readonly DiagnosticSource[] = readonly DiagnosticSource[],
> {
  readonly kind: "composite";
  readonly sources: Sources;
}

export type DiagnosticSource =
  | WorkflowDiagnosticSource
  | RepositoryDiagnosticSource
  | CompositeDiagnosticSource;

export type DiagnosticSourceKind = DiagnosticSource["kind"];

export interface DiagnosticSourceRef {
  readonly kind: DiagnosticSourceKind;
  readonly workflowPath?: string;
  readonly location?: SourceLocation;
  readonly sources?: readonly DiagnosticSourceRef[];
}

export type ProvenancedDiagnostic<S extends DiagnosticSource = DiagnosticSource> = Diagnostic & {
  readonly source: S;
};

export function composeDiagnosticSources<
  // fallow-ignore unused-exports
  const Sources extends readonly [DiagnosticSource, ...DiagnosticSource[]],
>(...sources: Sources): CompositeDiagnosticSource<Sources> {
  return {
    kind: "composite",
    sources,
  };
}

export function diagnosticSourceToRef(source: DiagnosticSource): DiagnosticSourceRef {
  // fallow-ignore unused-exports
  if (source.kind === "composite") {
    return {
      kind: "composite",
      sources: source.sources.map(diagnosticSourceToRef),
    };
  }

  return {
    kind: source.kind,
    workflowPath: source.workflowPath,
    location: source.location,
  };
}
