module FuzzJson

/*
 The JSON guard contract: only plain objects are accepted, so a target may
 read fields only after acceptance. Value classes are the ones `JSON.parse`
 can produce. Concrete call sites are checked by `test/fuzz-json-guard.test.ts`.
*/

abstract sig Value {}
one sig JNull extends Value {}
one sig JBool extends Value {}
one sig JNum extends Value {}
one sig JText extends Value {}
sig JArray extends Value {}
sig JObject extends Value { fields: set JField }
sig JField {}

pred isObject[v: Value] { v in JObject }

pred guard[v: Value, out: set Value] {
  (isObject[v] and out = v) or (not isObject[v] and no out)
}

assert AcceptedIsObject {
  all v: Value, out: set Value | guard[v, out] and some out implies out in JObject
}

assert RejectedIsNotObject {
  all v: Value, out: set Value | guard[v, out] and no out implies not isObject[v]
}

assert AcceptedPreservesValue {
  all v: Value, out: set Value | guard[v, out] and some out implies out = v
}

assert EveryValueDecided {
  all v: Value |
    (isObject[v] implies guard[v, v])
    and (not isObject[v] implies no out: Value | guard[v, out])
}

check AcceptedIsObject for 8 expect 0
check RejectedIsNotObject for 8 expect 0
check AcceptedPreservesValue for 8 expect 0
check EveryValueDecided for 8 expect 0

run ObjectAccepted {
  some v: Value, out: set Value | guard[v, out] and v in JObject and out = v
} for 8

run NullRejected {
  some v: Value, out: set Value | guard[v, out] and v in JNull and no out
} for 8

run ArrayRejected {
  some v: Value, out: set Value | guard[v, out] and v in JArray and no out
} for 8

run PrimitiveRejected {
  some v: Value, out: set Value |
    guard[v, out] and (v in JBool or v in JNum or v in JText) and no out
} for 8

/* Control: a guard that only checks array-ness accepts null. */
pred brokenJNullCheck[v: Value, out: set Value] {
  (v in JArray and no out) or (v not in JArray and out = v)
}

assert BrokenNullCheckAcceptsNull {
  all v: Value, out: set Value |
    brokenJNullCheck[v, out] and some out implies out in JObject
}

check BrokenNullCheckAcceptsNull for 8 expect 1

/* Control: a guard that only checks null-ness accepts arrays. */
pred brokenJArrayCheck[v: Value, out: set Value] {
  (v in JNull and no out) or (v not in JNull and out = v)
}

assert BrokenArrayCheckAcceptsArray {
  all v: Value, out: set Value |
    brokenJArrayCheck[v, out] and some out implies out in JObject
}

check BrokenArrayCheckAcceptsArray for 8 expect 1

/* Control: `typeof value === "object"` alone accepts null and arrays. */
pred shallowGuard[v: Value, out: set Value] {
  (v in JNull or v in JArray) and out = v
  or (v not in JNull and v not in JArray and v in JObject) and out = v
  or (v in JBool or v in JNum or v in JText) and no out
}

assert ShallowGuardAcceptsNonObject {
  all v: Value, out: set Value |
    shallowGuard[v, out] and some out implies out in JObject
}

check ShallowGuardAcceptsNonObject for 8 expect 1
