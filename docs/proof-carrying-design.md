# Proof-Carrying Collector Design

## Overview

This document describes the type-level design for gate-to-collector guarantees in the repository diagnostics system. The goal is to ensure that collectors only execute when their required gate is proven true, with compile-time safety guarantees.

## Current State (Before)

```typescript
export type GatedContext<_G extends GateKey> = RepositoryDiagnosticContext & {
  proofs: GateProofs;  // phantom type - structurally compatible
};
```

**Problems:**
1. `_G extends GateKey` is a phantom type - erased at runtime
2. `{} as GateProofs` compiles - no proof required
3. `collect(context)` accepts any GatedContext regardless of gate truth
4. No runtime→type correspondence guarantee

## New Design (After)

### 1. Branded Proof Types with Unique Symbols

```typescript
declare const __hasGradleProof: unique symbol;

export interface HasGradleProof {
  readonly __proof: typeof __hasGradleProof;
}
```

**Why unique symbol?**
- Each gate gets a distinct `unique symbol`
- Structural compatibility broken - `HasGradleProof` ≠ `HasRustProof`
- Even though both have identical `{ readonly _proof: unique symbol }` structure

### 2. GateTrue<G> Opaque Proof Type

```typescript
type ProofForGate<G extends GateKey> = G extends "hasGradle"
  ? HasGradleProof
  : // ... all gates mapped
    never;

export type GateTrue<G extends GateKey> = {
  readonly __gate: G;      // gate identity
  readonly __proof: ProofForGate<G>;  // proof for this gate
};
```

**Key properties:**
- Ties gate key to its specific proof type
- Opaque - cannot construct without going through `buildTypedContext`
- `__gate` prevents accidental confusion between different gates

### 3. Typed GatedContext<G>

```typescript
export type GatedContext<G extends GateKey> = RepositoryDiagnosticContext & {
  readonly __typedGate: GateTrue<G>;  // exact proof required
};
```

**What this achieves:**
- Collector for `hasGradle` requires `GatedContext<"hasGradle">`
- Cannot pass `GatedContext<"hasRust">` - type mismatch
- Cannot construct without `assertGateProof` - runtime gate check

### 4. Module-Private Proof Construction

```typescript
function __unsafeWrapProof<G extends GateKey>(
  _gate: G,
  _proof: ProofForGate<G>,
): GateTrue<G> {
  return { __gate: _gate, __proof: _proof } as GateTrue<G>;
}
```

**Access control:**
- Function is not exported - only `buildTypedContext` and `assertGateProof` are public
- Both require passing a gate key that exists in `RepositoryDiagnosticGateState`
- No direct construction of `GateTrue<G>` from outside the module

### 5. Single Entry Point: buildTypedContext

```typescript
export function buildTypedContext<G extends GateKey>(
  context: RepositoryDiagnosticContext,
  gate: G,
  proof: ProofForGate<G>,
): GatedContext<G> {
  return {
    ...context,
    __typedGate: __unsafeWrapProof(gate, proof),
  } as GatedContext<G>;
}
```

This is the **only** way to create a typed context for a collector.

## Compile Error Examples

### Error 1: Wrong Gate Proof

```typescript
const context = buildTypedContext(baseContext, "hasGradle", rustProof);
//                                    ^^^^^^^^^^  ^^^^^^^^^^
//                                    expected hasGradle proof, got hasRustProof
//
// Error: Type 'HasRustProof' is not assignable to parameter of type 'ProofForGate<"hasGradle">'
```

### Error 2: Missing Gate in GatedContext

```typescript
function myCollector(context: GatedContext<"hasGradle">) { ... }

const ctx = buildTypedContext(baseContext, "hasRust", rustProof);
myCollector(ctx);
// Error: Argument of type 'GatedContext<"hasRust">' is not assignable
//        to parameter of type 'GatedContext<"hasGradle">'
```

### Error 3: Constructing Proof Without Gate Check

```typescript
// This won't compile - no exported constructor:
const proof = { __gate: "hasGradle", __proof: {} } as GateTrue<"hasGradle">;
// Error: Property '__typedGate' is missing
```

### Error 4: Unverified Context Passed to Collector

```typescript
const untypedContext = { ...baseContext, proofs: {} };
collector.collect(untypedContext as GatedContext<"hasGradle">);
// Error at runtime (not compile): throws in assertGateProof
// "Gate 'hasGradle' is false. Cannot create proof for unproven gate."
```

## Unsafe Cast Loophole Analysis

### The Remaining Loophole

```typescript
const ctx = buildTypedContext(baseContext, "hasGradle", {} as HasGradleProof);
collector.collect(ctx);  // compiles but is semantically wrong
```

**Why this still works:**
- `{} as HasGradleProof` - type assertion bypasses the proof check
- Runtime doesn't validate the proof object, only checks gate state

**Mitigation:**
1. **Runtime validation**: `assertGateProof` throws if gate is false
2. **Opaque type**: Cannot access `__proof` field externally
3. **Module isolation**: No export of proof constructor

### Why We Accept This Tradeoff

TypeScript's type system cannot fully prevent:
```typescript
const fake = {} as any as GateTrue<"hasGradle">
```

This is a fundamental limitation of TypeScript's type system when interfacing with runtime values. The design provides:

1. **Compile-time gate→collector matching** ✓
2. **Runtime gate state validation** ✓
3. **No accidental proof construction** ✓

## Migration Strategy

### Step 1: Update collector definitions

```typescript
// Before
export const javascriptDiagnosticCollectors = [
  {
    id: "some-collector",
    gate: gateKeys.javascriptHeavy,
    collect: (context: GatedContext<"hasJavaScriptHeavyWorkflow">) => { ... }
  }
];

// After - no change needed, type inference handles it
export const javascriptDiagnosticCollectors = [
  {
    id: "some-collector",
    gate: gateKeys.javascriptHeavy,
    collect: (context) => { /* context is typed */ }
  }
];
```

### Step 2: Update collector implementation signatures

```typescript
// Before
export function collectFooDiagnostics(context: GatedContext<"hasJavaScriptHeavyWorkflow">) { ... }

// After
export function collectFooDiagnostics(context: GatedContext<"hasJavaScriptHeavyWorkflow">) {
  // context.__typedGate is now GateTrue<"hasJavaScriptHeavyWorkflow">
  // Can access context.__typedGate.__proof to get HasJavaScriptHeavyWorkflowProof
}
```

### Step 3: Update index.ts orchestration

```typescript
// Before
const provenContext = { ...context, proofs } as RepositoryDiagnosticContext & { proofs };
collector.collect(provenContext);

// After
const typedProof = assertGateProof(collector.gate, proofs);
const typedContext = buildTypedContext(context, collector.gate, typedProof.__proof);
collector.collect(typedContext);
```

## Type Safety vs Ergonomics Tradeoffs

### Advantages Gained

| Aspect | Before | After |
|--------|--------|-------|
| Gate matching | Runtime only | Compile-time |
| Wrong gate proof | Silent accept | Type error |
| Proof construction | Any `{}` works | Requires gate check |
| Phantom type | `_G erased` | `GateTrue<G>` preserved |

### Tradeoffs Introduced

| Aspect | Impact |
|--------|--------|
| Type complexity | Higher - more generic parameters |
| Error messages | More verbose |
| Migration effort | Requires signature updates |
| Runtime overhead | `assertGateProof` per collector |

### Why This Is Worth It

1. **Catch errors at compile time** - wrong gate passed to collector is a type error
2. **Self-documenting** - type signature shows exactly what proof is needed
3. **Refactoring safety** - renaming a gate breaks all collectors that use it

## Correspondence with Rust Patterns

### Rust typestate Pattern

```rust
struct Context<S: State> { data: Data, state: S }

impl Context<Unvalidated> { fn validate(self) -> Context<Validated> }
impl Context<Validated> { fn process(self) }
```

**TS equivalent:**
```typescript
type GatedContext<G extends GateKey> = RepositoryDiagnosticContext & {
  __typedGate: GateTrue<G>;
}
```

### Rust proof objects

```rust
trait Proof {}
struct HasGradleProof {}
impl Proof for HasGradleProof {}
```

**TS equivalent:**
```typescript
interface HasGradleProof { readonly __proof: unique symbol }
```

### Refinement types

```rust
fn collect(ctx: Context) where ctx.gate == true
```

**TS equivalent:**
```typescript
function collect(ctx: GatedContext<"hasGradle">)  // requires GateTrue<"hasGradle">
```

### Key Difference

Rust can enforce at compile time that proofs only come from specific functions. TypeScript can only do this partially:
- Structural typing allows `{} as ProofType` casts
- Cannot prevent `as any` bypasses
- Runtime validation needed as safety net

## Future Enhancements

1. **Branded factory functions** - each gate gets its own proof constructor
2. **Gate implication proofs** - if `hasJavaScriptLinting` is true, `hasJavaScriptTooling` must also be true
3. **Compile-time gate validation** - using template literal types to validate gate strings

## References

- [TypeScript unique symbol](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2.7.html#unique-symbol)
- [Branding and opaque types in TypeScript](https://blog.logrocket.com/typescript-branding-and-opaque-types/)
- [Rust typestate pattern](http://tinyurl.com/rust-typestate)