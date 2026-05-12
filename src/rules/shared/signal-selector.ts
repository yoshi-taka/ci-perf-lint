import type { RepositorySignals } from "../../repository-signals-types.ts";

export interface SignalSelector<A> {
  select(signals: RepositorySignals): A;
}

export function selectSignal<A>(fn: (signals: RepositorySignals) => A): SignalSelector<A> {
  return { select: fn };
}
