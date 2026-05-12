import type { Diagnostic } from "../../types.ts";
import type { TransformAxis, TaggedTransform } from "./diagnostic-transform.ts";

export interface DiagnosticEnricher<Ctx> {
  readonly label: string;
  readonly axes: readonly TransformAxis[];
  enrich(diagnostic: Diagnostic, ctx: Ctx): Diagnostic;
}

export function composeEnrichers<Ctx>(
  ...enrichers: DiagnosticEnricher<Ctx>[]
): DiagnosticEnricher<Ctx> {
  if (enrichers.length === 0) {
    return {
      label: "identity",
      axes: [],
      enrich: (d) => d,
    };
  }

  return {
    label: enrichers.map((e) => e.label).join(" > "),
    axes: enrichers.flatMap((e) => e.axes),
    enrich: (d, ctx) => enrichers.reduce((acc, e) => e.enrich(acc, ctx), d),
  };
}

export function contramap<C1, C2>(
  enricher: DiagnosticEnricher<C1>,
  f: (ctx: C2) => C1,
): DiagnosticEnricher<C2> {
  return {
    label: enricher.label,
    axes: enricher.axes,
    enrich: (d, ctx) => enricher.enrich(d, f(ctx)),
  };
}

export function toTaggedEnrich<Ctx>(enricher: DiagnosticEnricher<Ctx>, ctx: Ctx): TaggedTransform {
  return {
    transform: (d) => enricher.enrich(d, ctx),
    axes: enricher.axes,
    label: enricher.label,
  };
}
