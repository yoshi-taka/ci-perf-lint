import type { RepositorySignals } from "./repository-signals-types.ts";

export interface RepositorySignalSets {
  eslint: {
    pluginNames: Set<string>;
    unsupportedPluginNames: Set<string>;
  };
  prettier: {
    pluginNames: Set<string>;
  };
  nativePackages: {
    node: Set<string>;
    python: Set<string>;
  };
  npm: {
    npmrcFiles: Set<string>;
    npmrcRelevantSettings: Set<string>;
    lifecycleHookScripts: Set<string>;
    packageScriptEnvReferences: Set<string>;
    workflowEnvReferences: Set<string>;
  };
}

const signalSetsCache = new WeakMap<RepositorySignals, RepositorySignalSets>();

export function getSignalSets(signals: RepositorySignals): RepositorySignalSets {
  const cached = signalSetsCache.get(signals);
  if (cached) {
    return cached;
  }

  const sets: RepositorySignalSets = {
    eslint: {
      pluginNames: new Set(signals.eslint.pluginNames),
      unsupportedPluginNames: new Set(signals.eslint.unsupportedPluginNames),
    },
    prettier: {
      pluginNames: new Set(signals.prettier.pluginNames),
    },
    nativePackages: {
      node: new Set(signals.nativePackages.node),
      python: new Set(signals.nativePackages.python),
    },
    npm: {
      npmrcFiles: new Set(signals.npm.npmrcFiles),
      npmrcRelevantSettings: new Set(signals.npm.npmrcRelevantSettings),
      lifecycleHookScripts: new Set(signals.npm.lifecycleHookScripts),
      packageScriptEnvReferences: new Set(signals.npm.packageScriptEnvReferences),
      workflowEnvReferences: new Set(signals.npm.workflowEnvReferences),
    },
  };

  signalSetsCache.set(signals, sets);
  return sets;
}

export function setDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of a) {
    if (!b.has(item)) {
      result.add(item);
    }
  }
  return result;
}
