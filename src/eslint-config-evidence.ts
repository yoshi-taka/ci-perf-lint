/**
 * Blank out comments while preserving offsets and line breaks, so evidence
 * locations computed on the result still point at the original text.
 */
export function blankOutCodeComments(text: string): string {
  let result = "";
  let index = 0;
  let quote: string | undefined;
  let atLineStart = true;

  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];

    if (quote) {
      result += char;
      if (char === "\\" && next !== undefined) {
        result += next;
        index += 2;
        atLineStart = false;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      if (char === "\n") {
        atLineStart = true;
      } else {
        atLineStart = false;
      }
      index++;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      result += char;
      atLineStart = false;
      index++;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        result += " ";
        index++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        const current = text[index]!;
        result += current === "\n" ? "\n" : " ";
        if (current === "\n") {
          atLineStart = true;
        }
        index++;
      }
      if (index < text.length) {
        result += "  ";
        index += 2;
      }
      continue;
    }

    // Whole-line YAML comments (and shebangs) are not code evidence either.
    if (char === "#" && atLineStart) {
      while (index < text.length && text[index] !== "\n") {
        result += " ";
        index++;
      }
      continue;
    }

    result += char;
    if (char === "\n") {
      atLineStart = true;
    } else if (char !== " " && char !== "\t" && char !== "\r") {
      atLineStart = false;
    }
    index++;
  }

  return result;
}

const flatPrettierRecommendedImportPattern =
  /(?:import\s+([A-Za-z_$][\w$]*)\s+from\s*|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*)['"`]eslint-plugin-prettier\/recommended['"`]\s*\)?/gi;

/** Flat config activates the recommended setup by importing it into the config array. */
function codeUsesFlatPrettierRecommendedConfig(text: string): boolean {
  const code = blankOutCodeComments(text);
  for (const match of code.matchAll(flatPrettierRecommendedImportPattern)) {
    const binding = match[1] ?? match[2];
    if (!binding) {
      continue;
    }
    const remaining = `${code.slice(0, match.index)} ${code.slice(match.index + match[0].length)}`;
    if (new RegExp(`\\b${binding}\\b`).test(remaining)) {
      return true;
    }
  }
  return false;
}

export function codeMentionsPrettierRecommendedConfig(text: string): boolean {
  const code = blankOutCodeComments(text);
  return (
    /plugin:prettier\/recommended|['"`]prettier\/recommended['"`]/i.test(code) ||
    codeUsesFlatPrettierRecommendedConfig(code)
  );
}

const prettierRuleSettingPattern = /['"`]prettier\/prettier['"`]\s*:\s*(\[[^\]]*\]|[^,}\n]+)/gi;

function isDisabledPrettierRuleSetting(setting: string): boolean {
  const normalized = setting.trim().replace(/^\[\s*/, "");
  return /^(?:0|["'`]?off["'`]?)(?:\s|,|\]|$)/i.test(normalized);
}

function prettierRuleSettings(text: string): string[] {
  return [...blankOutCodeComments(text).matchAll(prettierRuleSettingPattern)].map(
    (match) => match[1] ?? "",
  );
}

export function codeMentionsEnabledPrettierRule(text: string): boolean {
  const settings = prettierRuleSettings(text);
  return settings.length > 0 && settings.some((setting) => !isDisabledPrettierRuleSetting(setting));
}

export function codeDisablesPrettierRule(text: string): boolean {
  return prettierRuleSettings(text).some(isDisabledPrettierRuleSetting);
}

/** Only a real `plugins` entry counts; `extends: ["prettier"]` means eslint-config-prettier. */
export function codeMentionsPrettierPlugin(text: string): boolean {
  const code = blankOutCodeComments(text);
  return (
    /\bplugins\s*:\s*\[[^\]]*['"`]prettier['"`][^\]]*\]/i.test(code) ||
    /\bplugins\s*:\s*\{[^}]*\bprettier\b\s*(?::|,|\})/i.test(code) ||
    /\bplugins\s*:[ \t]*\r?\n(?:[ \t]*-[ \t]+['"`]?prettier\b[^\r\n]*(?:\r?\n|$))+/im.test(code)
  );
}
