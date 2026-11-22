import { OutlineFont } from "./font";
import { Raster } from "./raster";

const PAPER = [246, 243, 234] as const;
const BLUE = [34, 64, 196] as const;
const RED = [215, 61, 43] as const;
const YELLOW = [245, 198, 47] as const;
const INK = [28, 31, 35] as const;

// Break at word/hyphen boundaries; split long tokens only as a last resort.
export function wrapTitle(
  font: OutlineFont,
  title: string,
  size: number,
  maxWidth: number,
): string[] {
  const tokens = title
    .trim()
    .split(/(?<=-)|\s+/u)
    .filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const candidate = `${line}${line && !line.endsWith("-") ? " " : ""}${token}`;
    if (font.measure(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of token) {
      if (line && font.measure(line + character, size) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderOgPrototype(font: OutlineFont, title?: string): Buffer {
  const canvas = new Raster(1200, 630, PAPER);
  canvas.rect(0, 0, 18, 630, BLUE);
  canvas.rect(66, 50, 29, 29, RED);
  canvas.circle(121, 64, 15, YELLOW);
  canvas.text(font, "ci-perf-lint", 155, 79, 38, INK);
  canvas.text(
    font,
    title ? "RULE REFERENCE" : "STATIC ANALYSIS / CI PERFORMANCE",
    68,
    146,
    20,
    BLUE,
  );
  canvas.rect(66, 178, 852, 340, BLUE);
  canvas.circle(1034, 265, 82, YELLOW);
  canvas.rect(968, 379, 132, 132, RED);
  if (title) {
    let size = 68;
    let lines = wrapTitle(font, title, size, 752);
    while (lines.length > 4 && size > 30) {
      size -= 2;
      lines = wrapTitle(font, title, size, 752);
    }
    if (lines.length > 4) throw new Error("OG title exceeds the prototype's four-line layout.");
    const leading = size * 1.15;
    const firstBaseline = 348 - ((lines.length - 1) * leading) / 2 + size * 0.32;
    lines.forEach((line, i) =>
      canvas.text(font, line, 106, firstBaseline + i * leading, size, PAPER),
    );
  } else {
    canvas.text(font, "Find CI waste.", 106, 303, 84, PAPER);
    canvas.text(font, "Know what to fix first.", 106, 406, 66, PAPER);
  }
  canvas.text(font, "ci-perf-lint.veritycost.com", 68, 582, 24, INK);
  canvas.rect(968, 553, 132, 3, INK);
  canvas.text(font, title ? "RULES / CI" : "BUILD LESS.", 968, 583, 18, INK);
  return canvas.png();
}
