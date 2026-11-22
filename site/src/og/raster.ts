import { deflateSync } from "node:zlib";
import { flattenContour, OutlineFont } from "./font";

type Color = readonly [number, number, number];
interface Vertex {
  x: number;
  y: number;
}
const SAMPLE = 2;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, bytes: Uint8Array): Buffer {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const header = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc32(data));
  return Buffer.concat([header, data, checksum]);
}

export class Raster {
  private pixels: Uint8Array;
  private w: number;
  private h: number;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Color,
  ) {
    this.w = width * SAMPLE;
    this.h = height * SAMPLE;
    this.pixels = new Uint8Array(this.w * this.h * 3);
    this.rect(0, 0, width, height, background);
  }

  private span(y: number, left: number, right: number, color: Color) {
    if (y < 0 || y >= this.h) return;
    const end = Math.min(this.w, Math.ceil(right - 0.5));
    for (let x = Math.max(0, Math.ceil(left - 0.5)); x < end; x++) {
      const index = (y * this.w + x) * 3;
      this.pixels[index] = color[0];
      this.pixels[index + 1] = color[1];
      this.pixels[index + 2] = color[2];
    }
  }

  rect(x: number, y: number, width: number, height: number, color: Color) {
    for (
      let row = Math.max(0, Math.ceil(y * SAMPLE));
      row < Math.min(this.h, (y + height) * SAMPLE);
      row++
    ) {
      this.span(row, x * SAMPLE, (x + width) * SAMPLE, color);
    }
  }

  circle(x: number, y: number, radius: number, color: Color) {
    const cx = x * SAMPLE,
      cy = y * SAMPLE,
      r = radius * SAMPLE;
    for (let row = Math.max(0, Math.floor(cy - r)); row < Math.min(this.h, cy + r); row++) {
      const dx = Math.sqrt(Math.max(0, r * r - (row + 0.5 - cy) ** 2));
      this.span(row, cx - dx, cx + dx, color);
    }
  }

  // Nonzero winding preserves counters in letters such as B, O, and e.
  private fill(contours: Vertex[][], color: Color) {
    const edges = contours.flatMap((contour) =>
      contour.flatMap((point, i) => {
        const next = contour[(i + 1) % contour.length];
        if (!next || point.y === next.y) return [];
        return [
          {
            x: point.x,
            y: point.y,
            to: next,
            min: Math.min(point.y, next.y),
            max: Math.max(point.y, next.y),
            direction: next.y > point.y ? 1 : -1,
          },
        ];
      }),
    );
    const min = Math.max(0, Math.floor(Math.min(...edges.map((edge) => edge.min))));
    const max = Math.min(this.h, Math.ceil(Math.max(...edges.map((edge) => edge.max))));
    for (let row = min; row < max; row++) {
      const y = row + 0.5;
      const intersections = edges
        .filter((edge) => edge.min <= y && edge.max > y)
        .map((edge) => ({
          x: edge.x + ((y - edge.y) * (edge.to.x - edge.x)) / (edge.to.y - edge.y),
          direction: edge.direction,
        }))
        .sort((a, b) => a.x - b.x);
      let winding = 0,
        start = 0;
      for (const intersection of intersections) {
        if (!winding) start = intersection.x;
        winding += intersection.direction;
        if (!winding) this.span(row, start, intersection.x, color);
      }
    }
  }

  text(font: OutlineFont, text: string, x: number, baseline: number, size: number, color: Color) {
    let cursor = x;
    for (const character of text) {
      const contours = font.contours(font.glyph(character));
      if (contours.length)
        this.fill(
          contours.map((contour) =>
            flattenContour(
              contour,
              cursor * SAMPLE,
              baseline * SAMPLE,
              (size * SAMPLE) / font.units,
            ),
          ),
          color,
        );
      cursor += (font.advance(character) * size) / font.units;
    }
  }

  png(): Buffer {
    const stride = this.width * 3 + 1;
    const rows = Buffer.alloc(stride * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          for (let dy = 0; dy < SAMPLE; dy++) {
            for (let dx = 0; dx < SAMPLE; dx++) {
              sum += this.pixels[((y * SAMPLE + dy) * this.w + x * SAMPLE + dx) * 3 + channel] ?? 0;
            }
          }
          rows[y * stride + 1 + x * 3 + channel] = Math.round(sum / (SAMPLE * SAMPLE));
        }
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8;
    header[9] = 2; // RGB, no alpha; fully opaque social preview.
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}
