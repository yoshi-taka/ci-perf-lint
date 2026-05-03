export function dependencySectionsOf(packageJson: Record<string, unknown>): unknown[] {
  return [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ];
}

export function packageJsonHasDependency(
  packageJson: Record<string, unknown>,
  dependencyName: string,
): boolean {
  for (const section of dependencySectionsOf(packageJson)) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    if (typeof (section as Record<string, unknown>)[dependencyName] === "string") {
      return true;
    }
  }

  return false;
}

export function packageJsonDependencyVersionSpec(
  packageJson: Record<string, unknown>,
  dependencyName: string,
): string | undefined {
  const dependencySections = [
    packageJson.devDependencies,
    ...dependencySectionsOf(packageJson).filter(
      (section) => section !== packageJson.devDependencies,
    ),
  ];

  for (const section of dependencySections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    const versionSpec = (section as Record<string, unknown>)[dependencyName];
    if (typeof versionSpec === "string" && versionSpec.trim().length > 0) {
      return versionSpec;
    }
  }

  return undefined;
}

export function parseTypeScriptVersionSpec(versionSpec: string): {
  major?: number;
  minor?: number;
} {
  const match = versionSpec.match(/(\d+)\.(\d+)/);
  if (!match) {
    return {};
  }

  return {
    major: Number.parseInt(match[1] ?? "", 10),
    minor: Number.parseInt(match[2] ?? "", 10),
  };
}

export function parseSemverLikeVersionSpec(versionSpec: string): {
  major?: number;
  minor?: number;
  patch?: number;
} {
  const match = versionSpec.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    const partialMatch = versionSpec.match(/(\d+)\.(\d+)/);
    if (!partialMatch) {
      return {};
    }

    return {
      major: Number.parseInt(partialMatch[1] ?? "", 10),
      minor: Number.parseInt(partialMatch[2] ?? "", 10),
    };
  }

  return {
    major: Number.parseInt(match[1] ?? "", 10),
    minor: Number.parseInt(match[2] ?? "", 10),
    patch: Number.parseInt(match[3] ?? "", 10),
  };
}
