module FuzzRetention

/*
 Coverage retention: an input is added to the corpus only when it reaches a
 key that is not already in `seen`. Each input is reduced to its coverage set.
 Execution, mutation quality and worker restarts are outside this model.
*/

sig Key {}
sig Input { cov: set Key }
sig State { seen: set Key, corpus: set Input }

pred step[s, t: State, input: Input] {
  input.cov in s.seen implies (
    t.seen = s.seen and t.corpus = s.corpus
  )
  input.cov not in s.seen implies (
    t.seen = s.seen + input.cov and t.corpus = s.corpus + input
  )
}

assert NewCoverageRetained {
  all s, t: State, input: Input |
    step[s, t, input] and input.cov not in s.seen implies input in t.corpus
}

assert KnownCoverageDropped {
  all s, t: State, input: Input |
    step[s, t, input] and input.cov in s.seen and input not in s.corpus implies
      input not in t.corpus
}

assert SeenMonotone {
  all s, t: State, input: Input | step[s, t, input] implies s.seen in t.seen
}

check NewCoverageRetained for 4 expect 0
check KnownCoverageDropped for 4 expect 0
check SeenMonotone for 4 expect 0

run RetainedWitness { some s, t: State, input: Input | step[s, t, input] and input.cov not in s.seen and input in t.corpus } for 4
run DroppedWitness { some s, t: State, input: Input | step[s, t, input] and input.cov in s.seen } for 4

/* Positive control: a rule that ignores coverage drops a new input. */
pred brokenStep[s, t: State, input: Input] {
  t.seen = s.seen and t.corpus = s.corpus
}

assert BrokenDropsNew {
  all s, t: State, input: Input |
    brokenStep[s, t, input] and input.cov not in s.seen implies input in t.corpus
}

check BrokenDropsNew for 4 expect 1
