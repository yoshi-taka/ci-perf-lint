import Lean

/- Model of src/repository-diagnostics/gate-pruning.ts after the pruning fix.
   Projection: Boolean state and skipped-result flags. Reasons/observability are
   checked separately by the TS bridge, not erased from production behavior.
   Fuel bounds execution only; every emitted case must finish without exhaustion. -/
namespace Gates

structure Snapshot where
  values : List Bool
  skipped : List Bool
  deriving DecidableEq, Repr

def children (graph : List (List Nat)) (key : Nat) : List Nat := graph[key]?.getD []
def valueAt (s : Snapshot) (key : Nat) : Bool := s.values[key]?.getD false

def visit (s : Snapshot) (key : Nat) : Snapshot :=
  { values := s.values.set key false, skipped := s.skipped.set key true }

-- stack is represented top-first: JS pushes successors then pops the last one.
def walk : Nat → List (List Nat) → List Nat → List Nat → Snapshot → Snapshot × Bool
  | _, _, [], _, s => (s, false)
  | 0, _, _ :: _, _, s => (s, true)
  | fuel + 1, graph, key :: rest, seen, s =>
    if key ∈ seen then walk fuel graph rest seen s
    else
      let next := (children graph key).reverse ++ rest
      walk fuel graph next (key :: seen) (visit s key)

def prune (graph : List (List Nat)) (root : Nat) (values : List Bool) : Snapshot × Bool :=
  walk 32 graph (children graph root).reverse [] ⟨values, values.map (fun _ => false)⟩

-- Independent, eager reachability oracle, including paths through false nodes.
def closure (graph : List (List Nat)) (root : Nat) : List Nat :=
  (List.range graph.length).foldl (fun reached _ =>
    reached ++ reached.flatMap (children graph)) (children graph root)

def allDescendantsFalse (graph : List (List Nat)) (root : Nat) (s : Snapshot) : Bool :=
  (closure graph root).all fun key => !(valueAt s key)

-- A one-level star remains safe for every initial Boolean assignment.
theorem star_safe (a b c d : Bool) :
    allDescendantsFalse [[1, 2, 3, 4], [], [], [], []] 0
      (prune [[1, 2, 3, 4], [], [], [], []] 0 [false, a, b, c, d]).1 = true := by
  cases a <;> cases b <;> cases c <;> cases d <;> decide

-- Former counterexample: traversal now crosses a false intermediate.
theorem chain_cleared :
    let graph := [[1], [2], []]
    let result := prune graph 0 [false, false, true]
    result.2 = false ∧ result.1.values = [false, false, false] ∧
      result.1.skipped = [false, true, true] ∧
      allDescendantsFalse graph 0 result.1 = true := by decide

-- Separate obligation: children must imply their prerequisite, otherwise pruning
-- can suppress a true result even when traversal itself is correct.
def optimizedChild (parent child : Bool) : Bool := if parent then child else false

theorem no_loss_with_prerequisite (parent child : Bool)
    (dependency : child = true → parent = true) : optimizedChild parent child = child := by
  cases parent <;> cases child <;> simp_all [optimizedChild]

theorem missing_prerequisite_counterexample : optimizedChild false true ≠ true := by decide

def boolLists : Nat → List (List Bool)
  | 0 => [[]]
  | n + 1 => (boolLists n).flatMap fun xs => [false :: xs, true :: xs]

-- All topologically numbered DAGs on four vertices: six possible edges.
def graphFromBits (bits : List Bool) : List (List Nat) :=
  let edges := [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
  (List.range 4).map fun node =>
    (edges.zip bits).filterMap fun ((src, dst), enabled) =>
      if enabled && src == node then some dst else none

end Gates

def main : IO Unit := do
  let out ← IO.getStdout
  for bits in Gates.boolLists 6 do
    let graph := Gates.graphFromBits bits
    for values in Gates.boolLists 4 do
      for root in List.range 4 do
        let (result, exhausted) := Gates.prune graph root values
        out.putStrLn (Lean.Json.mkObj [
          ("graph", Lean.toJson graph), ("root", Lean.toJson root),
          ("before", Lean.toJson values), ("after", Lean.toJson result.values),
          ("skipped", Lean.toJson result.skipped), ("exhausted", Lean.toJson exhausted),
          ("allDescendantsFalse", Lean.toJson (Gates.allDescendantsFalse graph root result))
        ]).compress

#print axioms Gates.star_safe
#print axioms Gates.chain_cleared
#print axioms Gates.no_loss_with_prerequisite
#print axioms Gates.missing_prerequisite_counterexample
