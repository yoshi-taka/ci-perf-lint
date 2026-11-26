module DockerReachability

// Stages reference earlier stages through FROM or COPY --from. The requested
// output is the final stage unless CI passes an explicit --target.
sig Stage {
  refs : set Stage
}

one sig Output in Stage {}

fun reach : set Stage { Output.*refs }
fun nonReflReach : set Stage { Output.^refs }
fun oneStep : set Stage { Output + Output.refs }

pred closed (r : set Stage) {
  Output in r
  all s : r | s.refs in r
}

assert output_reachable {
  Output in reach
}

assert reach_closed {
  all s : reach | s.refs in reach
}

// Reachability is the least closed set: every closed set contains it.
assert reach_least {
  all r : set Stage | closed[r] => reach in r
}

// Broken control: non-reflexive closure misses the output stage.
assert broken_missing_output {
  Output in nonReflReach
}

// Broken control: one edge misses transitively referenced stages.
assert broken_missing_transitive {
  reach in oneStep
}

check output_reachable for 5
check reach_closed for 5
check reach_least for 5
check broken_missing_output for 5 expect 1
check broken_missing_transitive for 5 expect 1
