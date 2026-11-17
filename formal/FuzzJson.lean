import Init

/- Model of the JSON guard used by fuzz targets (`src/fuzz/json.ts`).

   Scope: the value classes that `JSON.parse` can return for valid JSON
   (null, boolean, number, string, array, object). Prototypes, accessors,
   `undefined`, `BigInt` and other non-JSON values are outside the model.
   The composition with concrete manifest call sites is checked by
   `test/fuzz-json-guard.test.ts`; this file proves the guard contract. -/
namespace FuzzJson

inductive Value where
  | null
  | boolean (value : Bool)
  | number (value : Int)
  | string (value : String)
  | array (elements : List Value)
  | object (fields : List (String × Value))

/-- `typeof value === "object" && value !== null && !Array.isArray(value)` -/
def isObject : Value → Bool
  | .object _ => true
  | _ => false

/-- `parseJsonObject`: objects pass through, every other JSON value is rejected. -/
def guard : Value → Option (List (String × Value))
  | .object fields => some fields
  | _ => none

def accepts (value : Value) : Bool := (guard value).isSome

theorem guard_object (fields : List (String × Value)) :
    guard (.object fields) = some fields := rfl

theorem guard_rejects_non_object (value : Value) (h : isObject value = false) :
    guard value = none := by
  cases value <;> simp [isObject, guard] at h ⊢

theorem accepted_is_object (value : Value) (fields : List (String × Value))
    (h : guard value = some fields) : isObject value = true := by
  cases value <;> simp [isObject, guard] at h ⊢

theorem rejected_is_non_object (value : Value) (h : guard value = none) :
    isObject value = false := by
  cases value <;> simp [isObject, guard] at h ⊢

theorem guard_none_iff (value : Value) :
    guard value = none ↔ isObject value = false := by
  constructor
  · exact rejected_is_non_object value
  · exact guard_rejects_non_object value

theorem accepts_iff_object (value : Value) :
    accepts value = true ↔ isObject value = true := by
  cases value <;> simp [accepts, guard, isObject]

theorem null_rejected : guard .null = none := rfl
theorem boolean_rejected (value : Bool) : guard (.boolean value) = none := rfl
theorem number_rejected (value : Int) : guard (.number value) = none := rfl
theorem string_rejected (value : String) : guard (.string value) = none := rfl
theorem array_rejected (elements : List Value) : guard (.array elements) = none := rfl

/-- Field lookup is only available after the guard accepted an object. -/
def lookup (fields : List (String × Value)) (name : String) : Option Value :=
  (fields.find? fun field => field.1 == name).map fun field => field.2

def field (value : Value) (name : String) : Option Value :=
  match guard value with
  | some fields => lookup fields name
  | none => none

theorem field_requires_object (value : Value) (name : String) (result : Value)
    (h : field value name = some result) : isObject value = true := by
  unfold field at h
  cases guarded : guard value with
  | none => simp [guarded] at h
  | some fields => exact accepted_is_object value fields guarded

theorem field_rejected_for_non_object (value : Value) (name : String)
    (h : isObject value = false) : field value name = none := by
  unfold field
  rw [guard_rejects_non_object value h]

end FuzzJson
