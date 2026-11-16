module RegexAnchor

/*
 Boolean decision table for BOL/EOL removal in regex-mutator.ts.

 `RemovalTwo` is the intended rule: a two-character removal is allowed only when
 the anchor starts an alternative and an adjacent `|` is present. The model is
 finite (three independent flags). Scanner behaviour, tokenization and parity
 with weapon-regex are not modeled here.
*/

abstract sig Flag {}
one sig AtAlternativeStart, NextPipe, PrevPipe extends Flag {}

pred removalTwo[c: set Flag] {
  AtAlternativeStart in c and (NextPipe in c or PrevPipe in c)
}

pred removalOne[c: set Flag] {
  not removalTwo[c]
}

assert OneOrTwo {
  all c: set Flag | removalTwo[c] or removalOne[c]
}

assert TwoRequiresStart {
  all c: set Flag | removalTwo[c] implies AtAlternativeStart in c
}

assert TwoRequiresPipe {
  all c: set Flag | removalTwo[c] implies (NextPipe in c or PrevPipe in c)
}

check OneOrTwo for 3 expect 0
check TwoRequiresStart for 3 expect 0
check TwoRequiresPipe for 3 expect 0

run Witness { some c: set Flag | removalTwo[c] } for 3
run OneWitness { some c: set Flag | removalOne[c] } for 3

/*
 Positive control: removing two characters whenever a pipe is adjacent, even
 when the anchor is not at an alternative start, must produce a counterexample.
*/
pred brokenRemovalTwo[c: set Flag] {
  NextPipe in c or PrevPipe in c
}

assert BrokenRequiresStart {
  all c: set Flag | brokenRemovalTwo[c] implies AtAlternativeStart in c
}

check BrokenRequiresStart for 3 expect 1
