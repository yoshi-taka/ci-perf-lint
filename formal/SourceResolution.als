module SourceResolution

// Static filesystem evidence only. Targets/configs are not executed.
sig File {}
sig Request { exact: lone File, candidates: set File }

// Mirrors exact-path precedence and unique-candidate resolution.
fun resolved[r: Request]: set File {
  some r.exact => r.exact else (#r.candidates = 1 => r.candidates else none)
}

assert AtMostOne { all r: Request | lone resolved[r] }
assert ExactWins { all r: Request | some r.exact implies resolved[r] = r.exact }
assert AmbiguousStaysLeaf {
  all r: Request | no r.exact and #r.candidates > 1 implies no resolved[r]
}
assert UniqueFound {
  all r: Request | no r.exact and one r.candidates implies resolved[r] = r.candidates
}

// Positive controls: safe resolution exists, as does an ambiguous request.
run UniqueWitness { some r: Request | no r.exact and one resolved[r] } for 4 expect 1
run AmbiguousWitness { some r: Request | no r.exact and #r.candidates > 1 } for 4 expect 1
check AtMostOne for 5 expect 0
check ExactWins for 5 expect 0
check AmbiguousStaysLeaf for 5 expect 0
check UniqueFound for 5 expect 0

// Same safety property must fail for a resolver accepting every candidate.
fun brokenResolved[r: Request]: set File { r.exact + r.candidates }
assert BrokenAtMostOne { all r: Request | lone brokenResolved[r] }
check BrokenAtMostOne for 4 expect 1
