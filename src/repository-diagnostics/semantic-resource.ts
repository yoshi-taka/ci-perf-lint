import type { RepositoryDiagnosticContext } from "./collector-types.ts";

export type ResourceId = string & { readonly __brand: "ResourceId" };

export interface SemanticResource<T> {
  readonly id: ResourceId;
  readonly requires?: ResourceId[];
  collect(ctx: RepositoryDiagnosticContext, getResource: ResourceGetter): Promise<T>;
}

export type ResourceGetter = <T>(id: ResourceId) => Promise<T>;

export interface ResourceResultEntry<T = unknown> {
  id: ResourceId;
  value: T;
  status: "resolved" | "cached";
  durationMs: number;
}

export interface ResourceEvaluationObservability {
  resources: ResourceResultEntry[];
  evaluationOrder: ResourceId[];
  cacheHits: number;
  cacheMisses: number;
}
