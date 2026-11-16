module MutationIntervals

/*
 Model of the empty-expression filter in `src/mutation/mutators.ts`.

 A CallExpression candidate is removed when another mutant site lies inside its
 interval; non-call mutants are never removed. Intervals are reduced to their
 integer start/end, so AST shape, mutator semantics and actual generation are
 outside this model. The Z3 bridge checks the predicate against generated data.
*/

abstract sig Site { start, end: Int }
sig CallSite extends Site {}
sig OtherSite extends Site {}

fact WellFormedInterval {
  all s: Site | s.start <= s.end
}

pred inside[c, s: Site] {
  c != s and c.start <= s.start and s.end <= c.end
}

pred kept[c: Site] {
  c not in CallSite or no s: Site | inside[c, s]
}

assert NonCallAlwaysKept {
  all c: OtherSite | kept[c]
}

assert KeptCallHasNoInside {
  all c: CallSite | kept[c] implies no s: Site | inside[c, s]
}

assert RemovedCallHasInside {
  all c: CallSite | not kept[c] implies some s: Site | inside[c, s]
}

run KeptWitness {
  some c: CallSite | kept[c]
} for 5

run NonCallWitness {
  some o: OtherSite, s: Site | inside[o, s]
} for 5

run NestedWitness {
  some c: CallSite | not kept[c]
} for 5

check NonCallAlwaysKept for 5 expect 0
check KeptCallHasNoInside for 5 expect 0
check RemovedCallHasInside for 5 expect 0

/*
 Positive control: this filter also drops non-call sites that contain another
 site. The assertion is expected to have a counterexample (expect 1), which
 shows the scope is not empty and the checker can fail.
*/
pred brokenKept[c: Site] {
  no s: Site | inside[c, s]
}

assert BrokenDropsOther {
  all c: OtherSite | brokenKept[c]
}

check BrokenDropsOther for 5 expect 1
