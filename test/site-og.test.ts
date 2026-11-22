import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { OutlineFont } from "../site/src/og/font";
import { Raster } from "../site/src/og/raster";
import { renderOgPrototype, wrapTitle } from "../site/src/og/card";
import { listRuleDocs } from "../site/src/lib/rules";

const font = new OutlineFont(
  await Bun.file(new URL("../site/assets/jost/Jost-600-Semi.ttf", import.meta.url)).bytes(),
);

function decodePng(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(2);
  const compressed: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") {
      compressed.push(png.subarray(at + 8, at + 8 + length));
    }
    at += length + 12;
  }
  const bytes = inflateSync(Buffer.concat(compressed));
  const stride = width * 3 + 1;
  expect(bytes.length).toBe(stride * height);
  for (let y = 0; y < height; y++) {
    expect(bytes[y * stride]).toBe(0);
  }
  return {
    width,
    height,
    bytes,
    pixel(x: number, y: number) {
      return [...bytes.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3)];
    },
  };
}

test("bundled font decodes metrics, curves, counters, and composite glyphs", () => {
  expect(font.units).toBe(1000);
  expect(font.advance("A")).toBe(711);
  expect(font.measure("A A", 100)).toBeCloseTo(172.2);
  expect(font.contours(font.glyph(" "))).toEqual([]);
  expect(font.contours(font.glyph("O"))).toHaveLength(2);
  expect(font.contours(font.glyph("é"))).toHaveLength(3);
  expect(() => font.glyph("🦄")).toThrow("no glyph");
});

test("PNG raster clips shapes and preserves both the body and counter of O", () => {
  const canvas = new Raster(120, 120, [255, 255, 255]);
  canvas.rect(-10, -10, 20, 20, [255, 0, 0]);
  canvas.text(font, "O", 10, 95, 100, [0, 0, 0]);
  const image = decodePng(canvas.png());
  expect(image.pixel(0, 0)).toEqual([255, 0, 0]);
  expect(image.pixel(119, 119)).toEqual([255, 255, 255]);
  expect(image.pixel(50, 60)).toEqual([255, 255, 255]);
  expect(image.pixel(15, 60)).toEqual([0, 0, 0]);
});

test("prototype cards are deterministic, opaque 1200x630 PNGs with Bauhaus colors", () => {
  const png = renderOgPrototype(font);
  expect(renderOgPrototype(font)).toEqual(png);
  const image = decodePng(png);
  expect([image.width, image.height]).toEqual([1200, 630]);
  expect(image.pixel(0, 0)).toEqual([34, 64, 196]);
  expect(image.pixel(30, 30)).toEqual([246, 243, 234]);
  expect(image.pixel(1034, 265)).toEqual([245, 198, 47]);
  expect(image.pixel(1000, 420)).toEqual([215, 61, 43]);
  expect(renderOgPrototype(font, "missing-concurrency")).not.toEqual(png);
});

test("all current rule titles fit the prototype without missing glyphs or truncated text", async () => {
  for (const rule of await listRuleDocs()) {
    let size = 68;
    let lines = wrapTitle(font, rule.title, size, 752);
    while (lines.length > 4 && size > 30) {
      size -= 2;
      lines = wrapTitle(font, rule.title, size, 752);
    }
    expect(lines.length).toBeLessThanOrEqual(4);
    for (const line of lines) {
      expect(font.measure(line, size)).toBeLessThanOrEqual(752);
    }
    expect(lines.join("").replace(/\s/g, "")).toBe(rule.title.replace(/\s/g, ""));
  }
});
