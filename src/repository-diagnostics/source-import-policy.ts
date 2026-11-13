export interface ImportAuditInput {
  runtime: boolean;
  hasBindings: boolean;
  relative: boolean;
  hasExtension: boolean;
  hasQuery: boolean;
  restrictedSuppressed: boolean;
  extensionsSuppressed: boolean;
}

/** Eligibility only. Package/name matching and repository gates are separate. */
export function importAuditDecisions(input: ImportAuditInput): {
  restricted: boolean;
  extensions: boolean;
} {
  return {
    restricted: input.runtime && input.hasBindings && !input.restrictedSuppressed,
    extensions:
      input.runtime &&
      input.relative &&
      !input.hasExtension &&
      !input.hasQuery &&
      !input.extensionsSuppressed,
  };
}

export function importSourceShape(source: string): {
  relative: boolean;
  hasExtension: boolean;
  hasQuery: boolean;
} {
  const pathname = source.split(/[?#]/, 1)[0] ?? "";
  return {
    relative:
      source === "." || source === ".." || source.startsWith("./") || source.startsWith("../"),
    hasExtension: /\.[^./]+$/.test(pathname),
    // Loader queries/fragments can change resolution semantics. Do not guess.
    hasQuery: /[?#]/.test(source),
  };
}
