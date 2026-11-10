import Lean

/- Faithful pure model of collector-types.ts result evaluation and gate-expr.ts
   simplify/flatten operations at c31cf22. Immutable, valid finite ASTs/records;
   no JS getters, resource exhaustion, or evaluation-cost model. Unknown/error
   propagation is deliberately left-biased, NOT three-valued Boolean algebra. -/
namespace GateExpression

inductive Result where
  | resolved (value : Bool)
  | skipped (reason : String)
  | error (reason : String)
  deriving DecidableEq, Repr

def andResult : Result → Result → Result
  | .resolved false, _ => .resolved false
  | .resolved true, right => right
  | .skipped reason, _ => .skipped reason
  | .error reason, _ => .error reason

def orResult : Result → Result → Result
  | .resolved true, _ => .resolved true
  | .resolved false, right => right
  | .skipped reason, _ => .skipped reason
  | .error reason, _ => .error reason

def notResult : Result → Result
  | .resolved value => .resolved (!value)
  | other => other

inductive Expr where
  | atom (gate : Nat)
  | and (left right : Expr)
  | or (left right : Expr)
  | not (inner : Expr)
  deriving DecidableEq, Repr

def eval (state : Nat → Result) : Expr → Result
  | .atom gate => state gate
  | .and left right => andResult (eval state left) (eval state right)
  | .or left right => orResult (eval state left) (eval state right)
  | .not inner => notResult (eval state inner)

theorem and_idempotent (r : Result) : andResult r r = r := by
  cases r with
  | resolved b => cases b <;> rfl
  | skipped _ => rfl
  | error _ => rfl

theorem or_idempotent (r : Result) : orResult r r = r := by
  cases r with
  | resolved b => cases b <;> rfl
  | skipped _ => rfl
  | error _ => rfl

theorem not_involutive (r : Result) : notResult (notResult r) = r := by
  cases r with
  | resolved b => cases b <;> rfl
  | skipped _ => rfl
  | error _ => rfl

theorem and_associative (a b c : Result) :
    andResult (andResult a b) c = andResult a (andResult b c) := by
  cases a with
  | resolved v => cases v <;> rfl
  | skipped _ => rfl
  | error _ => rfl

theorem or_associative (a b c : Result) :
    orResult (orResult a b) c = orResult a (orResult b c) := by
  cases a with
  | resolved v => cases v <;> rfl
  | skipped _ => rfl
  | error _ => rfl

-- gatesEqual intentionally does not recognize NOT nodes as equal.
def same : Expr → Expr → Bool
  | .atom a, .atom b => decide (a = b)
  | .and a b, .and c d => same a c && same b d
  | .or a b, .or c d => same a c && same b d
  | _, _ => false

theorem same_sound (a b : Expr) (h : same a b = true) : a = b := by
  induction a generalizing b with
  | atom _ => cases b <;> simp_all [same]
  | and _ _ ih₁ ih₂ =>
    cases b <;> simp_all [same, Bool.and_eq_true]
    exact ⟨ih₁ _ h.1, ih₂ _ h.2⟩
  | or _ _ ih₁ ih₂ =>
    cases b <;> simp_all [same, Bool.and_eq_true]
    exact ⟨ih₁ _ h.1, ih₂ _ h.2⟩
  | not _ _ => cases b <;> simp_all [same]

def dedupAnd (left right : Expr) : Expr :=
  if same left right then left else .and left right

def dedupOr (left right : Expr) : Expr :=
  if same left right then left else .or left right

def simplifyNot : Expr → Expr
  | .not inner => inner
  | other => .not other

def simplify : Expr → Expr
  | .atom gate => .atom gate
  | .and left right => dedupAnd (simplify left) (simplify right)
  | .or left right => dedupOr (simplify left) (simplify right)
  | .not inner => simplifyNot (simplify inner)

theorem eval_dedupAnd (state : Nat → Result) (a b : Expr) :
    eval state (dedupAnd a b) = andResult (eval state a) (eval state b) := by
  unfold dedupAnd
  split
  · rename_i h
    have equal := same_sound a b h
    subst b
    exact (and_idempotent _).symm
  · rfl

theorem eval_dedupOr (state : Nat → Result) (a b : Expr) :
    eval state (dedupOr a b) = orResult (eval state a) (eval state b) := by
  unfold dedupOr
  split
  · rename_i h
    have equal := same_sound a b h
    subst b
    exact (or_idempotent _).symm
  · rfl

theorem eval_simplifyNot (state : Nat → Result) (a : Expr) :
    eval state (simplifyNot a) = notResult (eval state a) := by
  cases a <;> simp [simplifyNot, eval, not_involutive]

-- ALL finite ASTs, all gate assignments and all reason strings; exact Result,
-- not merely whether the collector runs.
theorem simplify_preserves_result (state : Nat → Result) (e : Expr) :
    eval state (simplify e) = eval state e := by
  induction e <;> simp_all [simplify, eval, eval_dedupAnd, eval_dedupOr, eval_simplifyNot]

-- Exact AST shape of TS's one-level child expansion followed by left reduce.
def joinAnd : Expr → Expr → Expr
  | .and a b, .and c d => .and (.and (.and a b) c) d
  | left, .and c d => .and (.and left c) d
  | left, right => .and left right

def joinOr : Expr → Expr → Expr
  | .or a b, .or c d => .or (.or (.or a b) c) d
  | left, .or c d => .or (.or left c) d
  | left, right => .or left right

def flattenAnd : Expr → Expr
  | .atom gate => .atom gate
  | .and left right => joinAnd (flattenAnd left) (flattenAnd right)
  | .or left right => .or (flattenAnd left) (flattenAnd right)
  | .not inner => .not (flattenAnd inner)

def flattenOr : Expr → Expr
  | .atom gate => .atom gate
  | .and left right => .and (flattenOr left) (flattenOr right)
  | .or left right => joinOr (flattenOr left) (flattenOr right)
  | .not inner => .not (flattenOr inner)

theorem eval_joinAnd (state : Nat → Result) (a b : Expr) :
    eval state (joinAnd a b) = andResult (eval state a) (eval state b) := by
  cases a <;> cases b <;> simp [joinAnd, eval, and_associative]

theorem eval_joinOr (state : Nat → Result) (a b : Expr) :
    eval state (joinOr a b) = orResult (eval state a) (eval state b) := by
  cases a <;> cases b <;> simp [joinOr, eval, or_associative]

theorem flattenAnd_preserves_result (state : Nat → Result) (e : Expr) :
    eval state (flattenAnd e) = eval state e := by
  induction e <;> simp_all [flattenAnd, eval, eval_joinAnd]

theorem flattenOr_preserves_result (state : Nat → Result) (e : Expr) :
    eval state (flattenOr e) = eval state e := by
  induction e <;> simp_all [flattenOr, eval, eval_joinOr]

def evalBool (state : Nat → Bool) : Expr → Bool
  | .atom gate => state gate
  | .and left right => evalBool state left && evalBool state right
  | .or left right => evalBool state left || evalBool state right
  | .not inner => !(evalBool state inner)

theorem resolved_agrees_with_boolean (state : Nat → Bool) (e : Expr) :
    eval (fun gate => .resolved (state gate)) e = .resolved (evalBool state e) := by
  induction e with
  | atom _ => rfl
  | and a b ih₁ ih₂ => simp only [eval, evalBool, ih₁, ih₂]; cases evalBool state a <;> rfl
  | or a b ih₁ ih₂ => simp only [eval, evalBool, ih₁, ih₂]; cases evalBool state a <;> rfl
  | not _ ih => simp [eval, evalBool, ih, notResult]

theorem not_skipped (reason : String) : notResult (.skipped reason) = .skipped reason := by rfl
theorem not_error (reason : String) : notResult (.error reason) = .error reason := by rfl

-- Counterexamples, NOT failures of the current documented ordered policy.
theorem or_order_counterexample :
    orResult (.skipped "unknown") (.resolved true) = .skipped "unknown" ∧
    orResult (.resolved true) (.skipped "unknown") = .resolved true := by decide

theorem and_order_counterexample :
    andResult (.error "failed") (.resolved false) = .error "failed" ∧
    andResult (.resolved false) (.error "failed") = .resolved false := by decide

theorem distribution_counterexample :
    andResult (orResult (.resolved true) (.error "failed")) (.resolved false) ≠
      orResult (andResult (.resolved true) (.resolved false))
        (andResult (.error "failed") (.resolved false)) := by decide

def legacy (state : Nat → Result) : List Nat → Result
  | [] => .resolved true
  | gate :: rest => andResult (state gate) (legacy state rest)

def expressionsOfSize : Nat → List Expr
  | 0 => []
  | n + 1 =>
    (if n == 0 then [.atom 0, .atom 1, .atom 2] else []) ++
    (expressionsOfSize n).map Expr.not ++
    (List.range n).attach.flatMap fun ⟨i, hi⟩ =>
      have : i < n := List.mem_range.mp hi
      (expressionsOfSize i).flatMap fun left =>
        (expressionsOfSize (n - i)).flatMap fun right => [.and left right, .or left right]
termination_by n => n

def expressions : List Expr :=
  let a := Expr.atom 0; let b := Expr.atom 1; let c := Expr.atom 2
  (List.range 6).flatMap expressionsOfSize ++ [
    .and (.and a b) (.and a b), .or (.or a b) (.or a b),
    .and (.and a b) (.and b c), .or (.or a b) (.or b c),
    .not (.not (.and (.and a b) (.and a b))), .not (.and a (.or b (.not c))),
    .or (.and a c) (.and b c)]

def assignments : Nat → List (List Nat)
  | 0 => [[]]
  | n + 1 => (assignments n).flatMap fun xs => (List.range 4).map fun tag => tag :: xs

def gateLists : Nat → List (List Nat)
  | 0 => [[]]
  | n + 1 => (gateLists n).flatMap fun xs => [0 :: xs, 1 :: xs, 2 :: xs]

def gateName (gate : Nat) : String :=
  ["hasRust", "hasGradle", "hasJavaScriptTooling"][gate]?.getD "invalid"

def stateResult (tags : List Nat) (gate : Nat) : Result :=
  match tags[gate]?.getD 0 with
  | 0 => .resolved false
  | 1 => .resolved true
  | 2 => .skipped s!"not evaluated: {gate} 日本語"
  | _ => .error s!"failed: {gate}"

def resultJson : Result → Lean.Json
  | .resolved value => Lean.Json.mkObj [("status", Lean.toJson "resolved"), ("value", Lean.toJson value)]
  | .skipped reason => Lean.Json.mkObj [("status", Lean.toJson "skipped"), ("reason", Lean.toJson reason)]
  | .error reason => Lean.Json.mkObj [("status", Lean.toJson "error"), ("reason", Lean.toJson reason)]

def exprJson : Expr → Lean.Json
  | .atom gate => Lean.Json.mkObj [("kind", Lean.toJson "atom"), ("gate", Lean.toJson (gateName gate))]
  | .and left right => Lean.Json.mkObj [("kind", Lean.toJson "and"), ("left", exprJson left), ("right", exprJson right)]
  | .or left right => Lean.Json.mkObj [("kind", Lean.toJson "or"), ("left", exprJson left), ("right", exprJson right)]
  | .not inner => Lean.Json.mkObj [("kind", Lean.toJson "not"), ("inner", exprJson inner)]

end GateExpression

def main : IO Unit := do
  let out ← IO.getStdout
  for tags in GateExpression.assignments 3 do
    let state := GateExpression.stateResult tags
    let results := Lean.Json.arr (((List.range 3).map fun g => GateExpression.resultJson (state g)).toArray)
    for expr in GateExpression.expressions do
      out.putStrLn (Lean.Json.mkObj [
        ("kind", Lean.toJson "expression"), ("results", results),
        ("expr", GateExpression.exprJson expr),
        ("result", GateExpression.resultJson (GateExpression.eval state expr)),
        ("simplified", GateExpression.exprJson (GateExpression.simplify expr)),
        ("flattenedAnd", GateExpression.exprJson (GateExpression.flattenAnd expr)),
        ("flattenedOr", GateExpression.exprJson (GateExpression.flattenOr expr))]).compress
    for n in List.range 5 do
      for gates in GateExpression.gateLists n do
        out.putStrLn (Lean.Json.mkObj [
          ("kind", Lean.toJson "legacy"), ("results", results),
          ("gates", Lean.toJson (gates.map GateExpression.gateName)),
          ("result", GateExpression.resultJson (GateExpression.legacy state gates))]).compress

#print axioms GateExpression.simplify_preserves_result
#print axioms GateExpression.flattenAnd_preserves_result
#print axioms GateExpression.flattenOr_preserves_result
#print axioms GateExpression.resolved_agrees_with_boolean
#print axioms GateExpression.not_skipped
#print axioms GateExpression.not_error
#print axioms GateExpression.or_order_counterexample
#print axioms GateExpression.and_order_counterexample
#print axioms GateExpression.distribution_counterexample
