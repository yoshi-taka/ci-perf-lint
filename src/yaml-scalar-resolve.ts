export interface ScalarTagInput {
  schema: "core" | "yaml-1.1";
  tag: string;
  format?: string;
  variant?: number;
  source: string;
  intAsBigInt?: boolean;
}

function resolveInteger(input: ScalarTagInput): number | bigint {
  const legacy = input.schema === "yaml-1.1";
  let text = input.source;
  let negative = false;
  if (legacy && /^[+-]/.test(text)) {
    negative = text[0] === "-";
    text = text.slice(1);
  }
  let value: number | bigint;
  if (input.format === "TIME") {
    value = resolveTime(text, !!input.intAsBigInt);
  } else {
    const radix =
      input.format === "BIN" ? 2 : input.format === "OCT" ? 8 : input.format === "HEX" ? 16 : 10;
    const skip = radix === 10 ? 0 : legacy && radix === 8 ? 1 : 2;
    const digits = legacy ? text.slice(skip).replace(/_/g, "") : text.slice(skip);
    if (input.intAsBigInt) {
      const prefix = radix === 2 ? "0b" : radix === 8 ? "0o" : radix === 16 ? "0x" : "";
      value = BigInt(legacy ? prefix + digits : text);
    } else {
      value = Number.parseInt(digits, radix);
    }
  }
  return negative ? -value : value;
}

function resolveTime(source: string, big: boolean): number | bigint {
  const parts = source.replace(/_/g, "").split(":");
  if (big) {
    return parts.reduce((total, part) => total * 60n + BigInt(part), 0n);
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function resolveTimestamp(source: string): Date {
  const match =
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:(?:[Tt]|[ \t]+)(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d+))?(?:[ \t]*(Z|([-+])([0-2]?\d)(?::(\d{2}))?))?)?(?![\s\S])/.exec(
      source,
    );
  if (!match) {
    throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
  }
  const [, year, month, day, hour, minute, second, fraction, , sign, zoneHour, zoneMinute] = match;
  let time = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
    Number(`0.${fraction ?? "0"}`) * 1000,
  );
  if (zoneHour) {
    const offset = (Number(zoneHour) * 60 + Number(zoneMinute ?? 0)) * 60000;
    time += sign === "-" ? offset : -offset;
  }
  return new Date(time);
}

export function resolveScalarTag(
  input: ScalarTagInput,
  _onError: (message: string) => void,
): { value: unknown; minFractionDigits?: number } {
  const tag = input.tag.replace(/^tag:yaml.org,2002:/, "");
  const text = input.source;
  switch (tag) {
    case "str": {
      return { value: text };
    }
    case "null": {
      return { value: null };
    }
    case "bool": {
      return {
        value: input.schema === "yaml-1.1" ? (input.variant ?? 0) === 0 : /^[tT]/.test(text),
      };
    }
    case "int": {
      return { value: resolveInteger(input) };
    }
    case "float": {
      if (input.format === "TIME") {
        const negative = text[0] === "-";
        const value = resolveTime(text.replace(/^[+-]/, ""), false) as number;
        return { value: negative ? -value : value };
      }
      if (!input.format && (input.variant ?? 0) === 0) {
        return {
          value: text.toLowerCase().endsWith("nan") ? NaN : text[0] === "-" ? -Infinity : Infinity,
        };
      }
      const normalized = input.schema === "yaml-1.1" ? text.replace(/_/g, "") : text;
      const value = Number.parseFloat(normalized);
      const decimal = normalized.indexOf(".");
      const hasPrecision = !input.format && decimal !== -1 && normalized.endsWith("0");
      return hasPrecision
        ? { value, minFractionDigits: normalized.length - decimal - 1 }
        : { value };
    }
    case "binary": {
      return { value: Buffer.from(text, "base64") };
    }
    case "timestamp": {
      return { value: resolveTimestamp(text) };
    }
    default: {
      throw new Error("Unknown resolver descriptor");
    }
  }
}
