const decoder = new TextDecoder();

export function toastifySource(doc: { source?: string }, rawSource: string): void {
  if (rawSource.length < 256) {
    return;
  }

  const compressed = Bun.deflateSync(Buffer.from(rawSource));

  Object.defineProperty(doc, "source", {
    get() {
      const decompressed = decoder.decode(Bun.inflateSync(compressed));
      Object.defineProperty(this, "source", {
        value: decompressed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return decompressed;
    },
    configurable: true,
    enumerable: true,
  });
}
