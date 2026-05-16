import { hasBun } from "./bun.ts";
import { deflateSync as zlibDeflate, inflateSync as zlibInflate } from "node:zlib";

const decoder = new TextDecoder();

const compress = hasBun
  ? (buf: Uint8Array) => Bun.deflateSync(buf as Uint8Array<ArrayBuffer>)
  : (buf: Uint8Array) => zlibDeflate(Buffer.from(buf));
const decompress = hasBun
  ? (buf: Uint8Array) => Bun.inflateSync(buf as Uint8Array<ArrayBuffer>)
  : (buf: Uint8Array) => zlibInflate(Buffer.from(buf));

export function toastifySource(doc: { source?: string }, rawSource: string): void {
  if (rawSource.length < 256) {
    return;
  }

  const compressed = compress(new TextEncoder().encode(rawSource));

  Object.defineProperty(doc, "source", {
    get() {
      const decompressed = decoder.decode(decompress(compressed));
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
