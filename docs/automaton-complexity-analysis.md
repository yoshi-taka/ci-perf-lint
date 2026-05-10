# Tool Presence Scanning: Asymptotic Complexity Analysis

## Current Architecture (Regex-Only)

`computeToolPresence()` iterates all 30 regex patterns and calls `RegExp.test()` sequentially.

### Complexity

```
O(P × |T|)
```

- `P` = pattern count (= 30)
- `|T|` = text length (blob size, summed step text of all jobs)

Each `RegExp.test()` must scan the full text. V8's Irregexp engine compiles to IR and backtracks on NFA branches. For 30 distinct patterns, the text is scanned 30 times independently. The constant factor includes:
- Regex compilation overhead (once per pattern, negligible)
- Per-call DFA/NFA construction or JIT re-entry
- 30× full scans of the text

**Key limitation**: scaling is linear with both text size AND pattern count.

---

## Optimized Architecture (AC Automaton + Regex Verify)

`detectToolPresence()` runs a single Aho-Corasick pass over all keywords (≈130 extracted keywords), then falls back to original regex only for patterns whose keywords matched.

### Complexity

```
O(|T| + M × w_avg + K_verify × |T|_partial)
```

- `|T|` = single AC pass over text
- `M` = number of reported keyword matches
- `w_avg` = average match width (negligible)
- `K_verify` = pattern count that had at least one keyword hit
- `|T|_partial` = text length (partial, regex engine internal, but `test()` typically scans until match)

In the typical case (most workflows), only 3-5 out of 30 patterns have keyword hits, because:
- CI step text is dominated by `npm`, `pip`, `docker`, `node`, `python` tokens
- Specialized patterns like `hasTerraform`, `hasDatadog`, `hasElixir` almost never match
- AC pass avoids regex entirely for the remaining 25+ patterns

**Asymptotic advantage**: pattern count `P` no longer multiplies `|T|`. The AC automaton is O(|T|) regardless of P. The verification regexes apply only to `K_verify << P` patterns.

---

## Aho-Corasick Automaton Internals

### Construction

```
O(S × Σ)
```

- `S` = total distinct trie states (= sum of unique keyword prefixes, ≈300-400 for ~130 keywords)
- `Σ` = effective alphabet size (ASCII printable chars, BFS queue linear in S)

### Search

```
O(|T| + M)
```

Each input character advances the automaton state in O(1) amortized (character-to-child lookup from Map). The fail link chain traversal is amortized O(1) per character (each node visited at most once per fail step). Output collection (recording matches) is proportional to `M`, the match count.

### Memory

```
O(S × (avg_children + output_slots))
```

- Each trie node stores:
  - `children`: Map<number, Node> — average 2-3 entries, overhead ~80 bytes
  - `fail`: pointer → 8 bytes
  - `output`: number[] — average 0.2 entries

Total: ≈300-400 nodes × ~100 bytes ≈ 30-40 KB. Negligible in a Node.js heap.

### Worst-Case vs Average-Case

| Metric | Regex-Only | AC + Verify |
|--------|-----------|-------------|
| Best case (no keywords match) | O(P\|T\|) | O(\|T\|) |
| Average case (3-5 keywords match) | O(P\|T\|) | O(\|T\| + 5×regex) |
| Worst case (all keywords match) | O(P\|T\|) | O(\|T\| + P×\|T\|) |

The worst case for AC+verify (all keywords match) degenerates to same as regex-only. In practice this never occurs because keyword sets are disjoint (e.g., "terraform" and "datadog" cannot both appear in the same CI step text).

---

## Stratification Strategy

### Tier 1: Aho-Corasick Keyword Scan

- 130 keywords extracted from 30 patterns
- Single left-to-right pass, O(|T|)
- Reports which keyword indices matched
- Maps each keyword index back to its parent pattern key
- Short-circuits to `false` for patterns with no keyword match

### Tier 2: Regex Verification

Only runs when a pattern's keyword was found. Examples:
- `hasDockerBuild`: keyword "docker" found → verify `docker\s+build` or `docker/build-push-action@`
- `hasTerraform`: keyword "terraform" found → verify `terraform\s+init`
- `hasPython`: keyword "actions/setup-python@" found → exact match already, but `pip` keyword → verify `\bpip\s+install\b`

### Semantics Preservation

The regex verification step guarantees 100% backward compatibility:
- Word boundaries (`\b`) honored via original regex
- Whitespace flexibility (`\s+`) via original regex
- Case sensitivity: input is pre-lowered, patterns use `/i` or lowered literals
- Greedy/optional constructs handled by V8 regex engine
- No false positives (regex confirms or rejects)
- No false negatives (all matched keywords trigger verification)

---

## Benchmark Methodology

### Workloads

1. Small: ~2KB of CI step text (3 jobs, 5 steps each)
2. Medium: ~15KB (multi-job workflow with matrix)
3. Large: ~80KB (complex dd-trace-js workflow)
4. Generated 100x: ~250KB (repetitive pattern, stress test)

### Metrics

- Operations/second (higher is better)
- Match count comparison (semantics verification)
- Memory delta (AC trie overhead)

### Expected Results

| Workload | Regex-Only (ops/s) | AC+Verify (ops/s) | Speedup |
|----------|-------------------|-------------------|---------|
| Small (2KB) | 10,000 | 40,000 | 4× |
| Medium (15KB) | 1,500 | 8,000 | 5× |
| Large (80KB) | 400 | 2,500 | 6× |
| Generated (250KB) | 100 | 800 | 8× |

Speedup increases with text size because AC's single-pass O(|T|) dominates while regex-only degrades linearly with P.

---

## Future: Feature Bitmap Cache

Beyond automaton pre-filter, further optimization is possible:

### Bitmap Cache Strategy

Maintain a per-workflow `Uint32Array` bitmap where each bit represents one keyword's occurrence:

```
Keyword index i → bit position (i % 32) in word (i / 32)
```

After the first AC scan, serialize the bitmap to a `WeakMap<WorkflowDocument, Uint32Array>` or to the `WorkflowFacts` struct. On subsequent scans (e.g., during rule evaluation), check the bitmap in O(1) instead of re-scanning.

### Implementation Sketch

```ts
class KeywordBitmap {
  private words: Uint32Array;

  constructor(keywordCount: number) {
    this.words = new Uint32Array(Math.ceil(keywordCount / 32));
  }

  set(index: number): void {
    this.words[index >>> 5] |= 1 << (index & 31);
  }

  has(index: number): boolean {
    return (this.words[index >>> 5] & (1 << (index & 31))) !== 0;
  }
}
```

### Tradeoffs

- **Pro**: O(1) keyword presence check, no string scanning for repeated checks
- **Pro**: Dense bitmap (~5 bytes for 130 keywords, fits in L1 cache)
- **Con**: Adds ~200ns per bitmap check vs AC's ~1ms total scan
- **Con**: Bitmap is only useful when the same workflow is checked multiple times (current architecture checks each workflow once, so benefit is limited)
- **Decision path**: If a downstream consumer needs per-workflow keyword filtering across many rules, bitmap cache saves O(P) redundant regex. Current architecture's single-pass model doesn't need it.

### When To Deploy

- If `WorkflowFacts.toolPresence` is checked from many rules (currently only `repository-signals.ts`)
- If per-step (not per-workflow) tool presence is needed (would multiply scans)
- If AC construction cost is amortized over many lookups (currently built once, shared globally)
