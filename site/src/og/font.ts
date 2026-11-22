// Small outline reader for our bundled, trusted TrueType font. Not a general
// font engine: no hinting, shaping, variable fonts, or point-attached composites.
interface Point {
  x: number;
  y: number;
  on: boolean;
}
type Contours = Point[][];

export class OutlineFont {
  private view: DataView;
  private tables = new Map<string, number>();
  private cache = new Map<number, Contours>();
  readonly units: number;
  private longLoca: boolean;
  private metrics: number;
  private cmap: number;
  private cmapFormat: number;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (this.u32(0) !== 0x10000) throw new Error("Expected a TrueType outline font.");
    for (let i = 0; i < this.u16(4); i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
      this.tables.set(tag, this.u32(at + 8));
    }
    const head = this.table("head");
    this.units = this.u16(head + 18);
    this.longLoca = this.i16(head + 50) === 1;
    this.metrics = this.u16(this.table("hhea") + 34);
    const cmap = this.table("cmap");
    let chosen = 0;
    for (let i = 0; i < this.u16(cmap + 2); i++) {
      const at = cmap + 4 + i * 8;
      const platform = this.u16(at);
      if (platform !== 0 && platform !== 3) continue;
      const subtable = cmap + this.u32(at + 4);
      const format = this.u16(subtable);
      if (format === 12 || (!chosen && format === 4)) chosen = subtable;
    }
    if (!chosen) throw new Error("No Unicode character map in font.");
    this.cmap = chosen;
    this.cmapFormat = this.u16(chosen);
  }

  private u16(at: number) {
    return this.view.getUint16(at);
  }
  private i16(at: number) {
    return this.view.getInt16(at);
  }
  private u32(at: number) {
    return this.view.getUint32(at);
  }
  private table(name: string) {
    const offset = this.tables.get(name);
    if (offset === undefined) throw new Error(`Missing font table: ${name}`);
    return offset;
  }

  glyph(character: string): number {
    const code = character.codePointAt(0) ?? 0;
    const c = this.cmap;
    if (this.cmapFormat === 12) {
      for (let i = 0; i < this.u32(c + 12); i++) {
        const at = c + 16 + i * 12;
        const first = this.u32(at),
          last = this.u32(at + 4);
        if (code >= first && code <= last) return this.u32(at + 8) + code - first;
      }
    } else if (code <= 0xffff) {
      const count = this.u16(c + 6) / 2;
      for (let i = 0; i < count; i++) {
        if (code > this.u16(c + 14 + i * 2)) continue;
        if (code < this.u16(c + 16 + count * 2 + i * 2)) break;
        const delta = this.i16(c + 16 + count * 4 + i * 2);
        const rangeAt = c + 16 + count * 6 + i * 2;
        const range = this.u16(rangeAt);
        if (!range) return (code + delta) & 0xffff;
        const id = this.u16(rangeAt + range + (code - this.u16(c + 16 + count * 2 + i * 2)) * 2);
        return id ? (id + delta) & 0xffff : 0;
      }
    }
    throw new Error(`Bundled font has no glyph for ${JSON.stringify(character)}.`);
  }

  advance(character: string): number {
    const glyph = this.glyph(character);
    return this.u16(this.table("hmtx") + Math.min(glyph, this.metrics - 1) * 4);
  }

  measure(text: string, size: number): number {
    return ([...text].reduce((sum, char) => sum + this.advance(char), 0) * size) / this.units;
  }

  contours(glyph: number, depth = 0): Contours {
    if (depth > 12) throw new Error("Recursive font composite.");
    const cached = this.cache.get(glyph);
    if (cached) return cached;
    const loca = this.table("loca");
    const offset = (id: number) =>
      this.longLoca ? this.u32(loca + id * 4) : this.u16(loca + id * 2) * 2;
    if (offset(glyph) === offset(glyph + 1)) return [];
    const start = this.table("glyf") + offset(glyph);
    const count = this.i16(start);
    let at = start + 10;
    const contours: Contours = [];
    if (count >= 0) {
      if (!count) return [];
      const ends = Array.from({ length: count }, (_, i) => this.u16(at + i * 2));
      at += count * 2;
      const instructions = this.u16(at);
      at += 2 + instructions;
      const total = (ends.at(-1) ?? -1) + 1;
      const flags: number[] = [];
      while (flags.length < total) {
        const flag = this.view.getUint8(at++);
        flags.push(flag);
        if (flag & 8) {
          const repeat = this.view.getUint8(at++);
          for (let i = 0; i < repeat; i++) flags.push(flag);
        }
      }
      const coordinates = (shortBit: number, positiveBit: number) => {
        let value = 0;
        return flags.map((flag) => {
          if (flag & shortBit) {
            value += this.view.getUint8(at++) * (flag & positiveBit ? 1 : -1);
          } else if (!(flag & positiveBit)) {
            value += this.i16(at);
            at += 2;
          }
          return value;
        });
      };
      const xs = coordinates(2, 16),
        ys = coordinates(4, 32);
      let first = 0;
      for (const end of ends) {
        contours.push(
          flags.slice(first, end + 1).map((flag, i) => ({
            x: xs[first + i] ?? 0,
            y: ys[first + i] ?? 0,
            on: Boolean(flag & 1),
          })),
        );
        first = end + 1;
      }
    } else {
      let flags: number;
      do {
        flags = this.u16(at);
        const child = this.u16(at + 2);
        at += 4;
        if (!(flags & 2)) throw new Error("Point-attached composite font glyph not supported.");
        const word = Boolean(flags & 1);
        const dx = word ? this.i16(at) : this.view.getInt8(at);
        const dy = word ? this.i16(at + 2) : this.view.getInt8(at + 1);
        at += word ? 4 : 2;
        let xx = 1,
          yy = 1,
          xy = 0,
          yx = 0;
        const f2 = () => {
          const value = this.i16(at) / 16384;
          at += 2;
          return value;
        };
        if (flags & 8) xx = yy = f2();
        else if (flags & 64) {
          xx = f2();
          yy = f2();
        } else if (flags & 128) {
          xx = f2();
          xy = f2();
          yx = f2();
          yy = f2();
        }
        for (const contour of this.contours(child, depth + 1)) {
          contours.push(
            contour.map((point) => ({
              x: point.x * xx + point.y * xy + dx,
              y: point.x * yx + point.y * yy + dy,
              on: point.on,
            })),
          );
        }
      } while (flags & 32);
    }
    this.cache.set(glyph, contours);
    return contours;
  }
}

export function flattenContour(points: Point[], x: number, baseline: number, scale: number) {
  const expanded: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i],
      next = points[(i + 1) % points.length];
    if (!point || !next) continue;
    expanded.push(point);
    if (!point.on && !next.on)
      expanded.push({
        x: (point.x + next.x) / 2,
        y: (point.y + next.y) / 2,
        on: true,
      });
  }
  const start = expanded.findIndex((point) => point.on);
  if (start < 0) return [];
  const ordered = [...expanded.slice(start), ...expanded.slice(0, start)];
  const transformed = ordered.map((point) => ({
    x: x + point.x * scale,
    y: baseline - point.y * scale,
    on: point.on,
  }));
  const first = transformed[0];
  if (!first) return [];
  const polygon = [first];
  let previous = first;
  for (let i = 1; i <= transformed.length; i++) {
    const next = transformed[i % transformed.length];
    if (!next) continue;
    if (next.on) {
      polygon.push(next);
      previous = next;
    } else {
      const end = transformed[(i + 1) % transformed.length];
      if (!end) continue;
      const steps = Math.max(
        2,
        Math.ceil(
          (Math.hypot(next.x - previous.x, next.y - previous.y) +
            Math.hypot(end.x - next.x, end.y - next.y)) /
            6,
        ),
      );
      for (let step = 1; step <= steps; step++) {
        const t = step / steps,
          s = 1 - t;
        polygon.push({
          x: s * s * previous.x + 2 * s * t * next.x + t * t * end.x,
          y: s * s * previous.y + 2 * s * t * next.y + t * t * end.y,
          on: true,
        });
      }
      previous = end;
      i++;
    }
  }
  return polygon;
}
