import Lean

/- Abstract model of CircleCI `when` / `unless` step handling in
   src/circleci-command-expansion.ts. Conditions are compiled at config time;
   only statically known parameters are resolved. No YAML parsing or full
   CircleCI expression language is modeled. -/
namespace CircleCiSyntax

inductive Condition where
  | lit (value : Bool) : Condition
  | string (value : String) : Condition
  | param (value : String) : Condition
  | and (left right : Condition) : Condition
  | or (left right : Condition) : Condition
  | not (inner : Condition) : Condition
  deriving DecidableEq, Repr

def eval : Condition → Bool
  | .lit value => value
  | .string value => value.length > 0
  | .param value => value.length > 0
  | .and left right => eval left && eval right
  | .or left right => eval left || eval right
  | .not inner => !eval inner

inductive Kind where
  | when | unless
  deriving DecidableEq, Repr

def keepsSteps (kind : Kind) (condition : Bool) : Bool :=
  match kind with
  | .when => condition
  | .unless => !condition

structure Case where
  id : String
  kind : Kind
  condition : Condition
  keep : Bool

def cases : List Case :=
  [ { id := "when-true", kind := .when, condition := .lit true, keep := true },
    { id := "when-false", kind := .when, condition := .lit false, keep := false },
    { id := "unless-empty", kind := .unless, condition := .string "", keep := true },
    { id := "unless-value", kind := .unless, condition := .string "prod", keep := false },
    { id := "when-param-true", kind := .when, condition := .param "true", keep := true },
    { id := "when-param-empty", kind := .when, condition := .param "", keep := false },
    { id := "when-and", kind := .when, condition := .and (.lit true) (.lit false), keep := false },
    { id := "when-or", kind := .when, condition := .or (.lit false) (.lit true), keep := true },
    { id := "when-not", kind := .when, condition := .not (.lit false), keep := true } ]

theorem keepsSteps_when : keepsSteps .when true = true ∧ keepsSteps .when false = false := by decide
theorem keepsSteps_unless : keepsSteps .unless true = false ∧ keepsSteps .unless false = true := by decide
theorem and_is_conjunction (a b : Bool) : eval (.and (.lit a) (.lit b)) = (a && b) := rfl
theorem or_is_disjunction (a b : Bool) : eval (.or (.lit a) (.lit b)) = (a || b) := rfl
theorem not_involutive (value : Bool) : eval (.not (.not (.lit value))) = value := by cases value <;> rfl

end CircleCiSyntax

def main : IO Unit := do
  let out ← IO.getStdout
  for item in CircleCiSyntax.cases do
    let resolved := CircleCiSyntax.eval item.condition
    out.putStrLn (Lean.Json.mkObj [
      ("id", Lean.toJson item.id),
      ("resolved", Lean.toJson resolved),
      ("keep", Lean.toJson (CircleCiSyntax.keepsSteps item.kind resolved)),
      ("expectedKeep", Lean.toJson item.keep),
      ("resolved", Lean.toJson resolved)]).compress

#print axioms CircleCiSyntax.keepsSteps_when
#print axioms CircleCiSyntax.keepsSteps_unless
#print axioms CircleCiSyntax.and_is_conjunction
#print axioms CircleCiSyntax.or_is_disjunction
#print axioms CircleCiSyntax.not_involutive
