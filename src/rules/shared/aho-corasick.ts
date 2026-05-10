interface AhoCorasickNode {
  children: Map<number, AhoCorasickNode>;
  fail: AhoCorasickNode | null;
  output: number[];
}

export class AhoCorasickAutomaton {
  private readonly root: AhoCorasickNode;

  constructor(patterns: string[]) {
    this.root = { children: new Map(), fail: null, output: [] };
    this.buildTrie(patterns);
    this.buildFailureLinks();
  }

  private buildTrie(patterns: string[]): void {
    for (let i = 0; i < patterns.length; i++) {
      let node = this.root;
      const word = patterns[i]!;
      for (let j = 0; j < word.length; j++) {
        const code = word.charCodeAt(j);
        let child = node.children.get(code);
        if (!child) {
          child = { children: new Map(), fail: null, output: [] };
          node.children.set(code, child);
        }
        node = child;
      }
      node.output.push(i);
    }
  }

  private buildFailureLinks(): void {
    const queue: AhoCorasickNode[] = [];

    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const [code, child] of current.children) {
        let fail = current.fail;
        while (fail !== null && !fail.children.has(code)) {
          fail = fail.fail;
        }
        child.fail = fail !== null ? fail.children.get(code)! : this.root;

        if (child.fail.output.length > 0) {
          child.output = child.output.concat(child.fail.output);
        }

        queue.push(child);
      }
    }
  }

  search(text: string): Set<number> {
    const matched = new Set<number>();
    let node = this.root;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);

      while (node !== this.root && !node.children.has(code)) {
        node = node.fail!;
      }

      if (node.children.has(code)) {
        node = node.children.get(code)!;
      }

      if (node.output.length > 0) {
        for (const patIdx of node.output) {
          matched.add(patIdx);
        }
      }
    }

    return matched;
  }
}
