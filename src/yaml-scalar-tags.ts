export interface ScalarTagDescriptor {
  schema: "core" | "yaml-1.1";
  tag: string;
  format?: string;
  variant?: number;
}

export function scalarTagTest(input: ScalarTagDescriptor): RegExp | undefined {
  const legacy = input.schema === "yaml-1.1";
  const tag = input.tag.replace(/^tag:yaml.org,2002:/, "");
  switch (tag) {
    case "null": {
      return /^(?:~|null|Null|NULL)?$/;
    }
    case "bool": {
      if (legacy) {
        return input.variant === 1
          ? /^(?:n|N|no|No|NO|false|False|FALSE|off|Off|OFF)$/
          : /^(?:y|Y|yes|Yes|YES|true|True|TRUE|on|On|ON)$/;
      }
      return /^(?:true|True|TRUE|false|False|FALSE)$/;
    }
    case "int": {
      if (input.format === "BIN") {
        return /^[-+]?0b[01_]+$/;
      }
      if (input.format === "OCT") {
        return legacy ? /^[-+]?0[0-7_]+$/ : /^0o[0-7]+$/;
      }
      if (input.format === "HEX") {
        return legacy ? /^[-+]?0x[0-9a-fA-F_]+$/ : /^0x[0-9a-fA-F]+$/;
      }
      if (input.format === "TIME") {
        return /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/;
      }
      return legacy ? /^[-+]?[0-9][0-9_]*$/ : /^[-+]?[0-9]+$/;
    }
    case "float": {
      if (input.format === "TIME") {
        return /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/;
      }
      if (input.format === "EXP") {
        return legacy
          ? /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/
          : /^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[eE][-+]?[0-9]+$/;
      }
      if ((input.variant ?? 0) === 0) {
        return /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
      }
      return legacy ? /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/ : /^[-+]?(?:[0-9]+\.[0-9]*|\.[0-9]+)$/;
    }
    case "timestamp": {
      return legacy
        ? /^\d{4}-\d{1,2}-\d{1,2}(?:(?:[Tt]|[ \t]+)\d{1,2}:\d{1,2}:\d{1,2}(?:\.\d+)?(?:[ \t]*(?:Z|[-+][0-2]?\d(?::\d{2})?))?)?$/
        : undefined;
    }
    case "merge": {
      return legacy ? /^<<$/ : undefined;
    }
    default: {
      return undefined;
    }
  }
}
