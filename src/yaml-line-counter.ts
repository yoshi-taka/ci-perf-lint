/** Source locations use UTF-16 offsets, matching JavaScript string indexing. */
export class LineCounter {
  lineStarts: number[] = [];
  // The external parser invokes this callback through the adapter in yaml.ts.
  // fallow-ignore-next-line unused-class-member
  addNewLine = (offset: number): number => this.lineStarts.push(offset);

  linePos = (offset: number): { line: number; col: number } => {
    // Find the first line start greater than or equal to the requested offset.
    let start = 0;
    let end = this.lineStarts.length;
    while (start < end) {
      const middle = start + Math.floor((end - start) / 2);
      if (this.lineStarts[middle]! >= offset) {
        end = middle;
      } else {
        start = middle + 1;
      }
    }
    if (this.lineStarts[start] === offset) {
      return { line: start + 1, col: 1 };
    }
    if (start === 0) {
      return { line: 0, col: offset };
    }
    return { line: start, col: offset - this.lineStarts[start - 1]! + 1 };
  };
}
