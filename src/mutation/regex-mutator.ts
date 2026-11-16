interface RegexMutation {
  start: number;
  end: number;
  replacement: string;
}

/** Number of characters removed for a BOL/EOL anchor. A two-character
 * removal joins the anchor with an adjacent alternative separator. */
export function anchorRemovalLength(
  atAlternativeStart: boolean,
  nextPipe: boolean,
  prevPipe: boolean,
): 1 | 2 {
  return atAlternativeStart && (nextPipe || prevPipe) ? 2 : 1;
}

/**
 * Level-1 regex mutations compatible with weapon-regex (the Stryker mutator).
 * Supported: BOL/EOL removal, character-class negation, predefined and Unicode
 * class negation, quantifier removal and lookaround negation.
 *
 * This is a scanner, not a full regex AST: it handles the JS pattern syntax
 * needed by level-1 mutators, including escapes, nested groups and character
 * classes. Mutants are emitted in source order (quantifier removal before the
 * mutated atom, class/lookaround mutation before their children).
 */
export function mutateRegexPattern(pattern: string, flags: string): string[] {
  const unicodeClasses = flags.includes("u") || flags.includes("v");
  const mutants: string[] = [];

  function add(start: number, end: number, replacement: string): void {
    mutants.push(pattern.slice(0, start) + replacement + pattern.slice(end));
  }

  function quantifierEnd(at: number): number | undefined {
    const char = pattern[at];
    if (char === "*" || char === "+" || char === "?") {
      let end = at + 1;
      if (pattern[end] === "?" || pattern[end] === "+") {
        end += 1;
      }
      return end;
    }
    if (char === "{") {
      const match = /^\{\d+(?:,\d*)?\}/.exec(pattern.slice(at));
      if (match) {
        let end = at + match[0].length;
        if (pattern[end] === "?" || pattern[end] === "+") {
          end += 1;
        }
        return end;
      }
    }
    return undefined;
  }

  function findClassEnd(open: number): number {
    let i = open + 1;
    while (i < pattern.length) {
      if (pattern[i] === "\\") {
        i += 2;
      } else if (pattern[i] === "]") {
        return i;
      } else {
        i += 1;
      }
    }
    return pattern.length - 1;
  }

  function findGroupEnd(open: number): number {
    let depth = 0;
    let i = open;
    while (i < pattern.length) {
      const char = pattern[i];
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === "[") {
        i = findClassEnd(i) + 1;
        continue;
      }
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          return i;
        }
      }
      i += 1;
    }
    return pattern.length - 1;
  }

  function classChildren(start: number, end: number): void {
    let i = start;
    while (i < end) {
      if (pattern[i] !== "\\") {
        i += 1;
        continue;
      }
      const escape = escapeMutation(i);
      if (escape && escape.replacement !== pattern.slice(escape.start, escape.end)) {
        add(escape.start, escape.end, escape.replacement);
      }
      i += escape ? escape.end - i : 2;
    }
  }

  function escapeMutation(at: number): (RegexMutation & { tokenLength: number }) | undefined {
    const next = pattern[at + 1];
    if (next === undefined) {
      return undefined;
    }
    if ("dDsSwW".includes(next)) {
      const flipped = next === next.toLowerCase() ? next.toUpperCase() : next.toLowerCase();
      return { start: at, end: at + 2, replacement: `\\${flipped}`, tokenLength: 2 };
    }
    if ((next === "p" || next === "P") && unicodeClasses && pattern[at + 2] === "{") {
      const close = pattern.indexOf("}", at + 3);
      if (close >= 0) {
        const body = pattern.slice(at + 3, close);
        return {
          start: at,
          end: close + 1,
          replacement: `\\${next === "p" ? "P" : "p"}{${body}}`,
          tokenLength: close + 1 - at,
        };
      }
    }
    return { start: at, end: at + 2, replacement: pattern.slice(at, at + 2), tokenLength: 2 };
  }

  function anchorRemoval(
    start: number,
    end: number,
    at: number,
    atAlternativeStart: boolean,
  ): [number, number] {
    const next = pattern[at + 1];
    const rightBoundary = at + 1 === end || next === "|";
    const nextPipe = rightBoundary && next === "|";
    const prevPipe = rightBoundary && at > start && pattern[at - 1] === "|";
    if (anchorRemovalLength(atAlternativeStart, nextPipe, prevPipe) === 2) {
      return nextPipe ? [at, at + 2] : [at - 1, at + 1];
    }
    return [at, at + 1];
  }

  function scan(start: number, end: number): void {
    let i = start;
    let atAlternativeStart = true;
    while (i < end) {
      const char = pattern[i];
      if (char === "|") {
        atAlternativeStart = true;
        i += 1;
        continue;
      }
      if (char === "^" || char === "$") {
        const [from, to] = anchorRemoval(start, end, i, atAlternativeStart);
        add(from, to, "");
        atAlternativeStart = false;
        i += 1;
        continue;
      }
      if (char === "\\") {
        const atom = escapeMutation(i);
        const atomEnd = atom ? atom.end : Math.min(i + 2, end);
        const quantifier = quantifierEnd(atomEnd);
        if (quantifier !== undefined && quantifier <= end) {
          add(atomEnd, quantifier, "");
          i = quantifier;
        } else {
          i = atomEnd;
        }
        if (atom && atom.replacement !== pattern.slice(atom.start, atom.end)) {
          add(atom.start, atom.end, atom.replacement);
        }
        atAlternativeStart = false;
        continue;
      }
      if (char === "[") {
        const close = findClassEnd(i);
        const quantifier = quantifierEnd(close + 1);
        if (quantifier !== undefined && quantifier <= end) {
          add(close + 1, quantifier, "");
        }
        const negated = pattern[i + 1] === "^";
        add(i + 1, i + 1 + (negated ? 1 : 0), negated ? "" : "^");
        const contentStart = i + 1 + (negated ? 1 : 0);
        classChildren(contentStart, close);
        i = quantifier !== undefined && quantifier <= end ? quantifier : close + 1;
        atAlternativeStart = false;
        continue;
      }
      if (char === "(") {
        const close = findGroupEnd(i);
        const quantifier = quantifierEnd(close + 1);
        if (quantifier !== undefined && quantifier <= end) {
          add(close + 1, quantifier, "");
        }
        let contentStart = i + 1;
        if (pattern.startsWith("(?=", i) || pattern.startsWith("(?!", i)) {
          add(i, i + 3, pattern.startsWith("(?=", i) ? "(?!" : "(?=");
          contentStart = i + 3;
        } else if (pattern.startsWith("(?<=", i) || pattern.startsWith("(?<!", i)) {
          add(i, i + 4, pattern.startsWith("(?<=", i) ? "(?<!" : "(?<=");
          contentStart = i + 4;
        } else if (pattern.startsWith("(?:", i)) {
          contentStart = i + 3;
        } else if (pattern.startsWith("(?<", i)) {
          const nameEnd = pattern.indexOf(">", i + 3);
          contentStart = nameEnd >= 0 ? nameEnd + 1 : i + 3;
        }
        scan(contentStart, close);
        i = quantifier !== undefined && quantifier <= end ? quantifier : close + 1;
        atAlternativeStart = false;
        continue;
      }
      const quantifier = quantifierEnd(i + 1);
      if (quantifier !== undefined && quantifier <= end) {
        add(i + 1, quantifier, "");
        i = quantifier;
      } else {
        i += 1;
      }
      atAlternativeStart = false;
    }
  }

  scan(0, pattern.length);
  // weapon-regex does not report mutations that produce an empty pattern.
  return mutants.filter((mutant) => mutant.length > 0);
}
