module MutationLifecycle

/*
 Abstract lifecycle for one mutation run. The runner removes the per-mutant
 temp directory in `finally`, so success, caught failure and timeout all reach
 the same cleanup transition. The runner-owned root is the only path removed;
 unrelated temp directories stay. A SIGKILL of the runner is not modeled; the
 next run removes a stale root before starting.

 This model does not encode paths or actual files; `MutationIntervals.als`
 covers filter structure and the Z3 bridge checks concrete temp paths.
*/

sig Dir {}
sig Content {}

abstract sig Outcome {}
one sig Running, Completed, TimedOut, Failed extends Outcome {}

sig State {
  live: set Dir,
  outside: set Dir,
  source: one Content,
  original: one Content
}

pred step[s, t: State, o: Outcome] {
  t.original = s.original
  o = Running implies (
    t.live = s.live and
    t.outside = s.outside and
    t.source = s.source
  )
  o != Running implies (
    no t.live and
    t.outside = s.outside and
    t.source = t.original
  )
}

assert TerminalCleansAndRestores {
  all s, t: State, o: Outcome |
    step[s, t, o] and o != Running implies (no t.live and t.source = t.original)
}

assert CleanupKeepsUnrelatedTemp {
  all s, t: State, o: Outcome |
    step[s, t, o] and o != Running implies t.outside = s.outside
}

check TerminalCleansAndRestores for 5 expect 0
check CleanupKeepsUnrelatedTemp for 5 expect 0

run TerminalWitness {
  some s, t: State | step[s, t, TimedOut] and some s.live
} for 5

/* Positive controls: each broken transition must produce a counterexample. */
pred brokenStep[s, t: State, o: Outcome] {
  t.original = s.original
  o = Running implies (
    t.live = s.live and
    t.outside = s.outside and
    t.source = s.source
  )
  (o = Completed or o = Failed) implies (
    no t.live and
    t.outside = s.outside and
    t.source = t.original
  )
  o = TimedOut implies (
    t.live = s.live and
    t.outside = s.outside and
    t.source = s.source
  )
}

assert TimeoutLeak {
  all s, t: State | brokenStep[s, t, TimedOut] implies no t.live
}

check TimeoutLeak for 5 expect 1

pred brokenOutside[s, t: State, o: Outcome] {
  t.original = s.original
  o = Running implies (
    t.live = s.live and
    t.outside = s.outside and
    t.source = s.source
  )
  o != Running implies (
    no t.live and
    no t.outside and
    t.source = t.original
  )
}

assert UnrelatedTempDeleted {
  all s, t: State, o: Outcome |
    brokenOutside[s, t, o] and o != Running implies t.outside = s.outside
}

check UnrelatedTempDeleted for 5 expect 1
