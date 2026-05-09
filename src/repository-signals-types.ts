import type { SourceLocation } from "./types.ts";
import type { RepositoryPrecedentSignals } from "./repository-similar-workflows.ts";

export interface RepositorySignals {
  primaryWorkflowPath?: string;
  workflowCount: number;
  heavyWorkflowCount: number;
  reusableWorkflowJobCount: number;
  compositeActionCount: number;
  hasMonorepoMarkers: boolean;
  looksLargeOrComplex: boolean;
  docker: {
    hasBakeFile: boolean;
  };
  stackedDiffs: {
    likelyUsed: boolean;
    provider?: "ghstack" | "github" | "graphite" | "unknown";
    evidence: string[];
  };
  similarWorkflows: {
    concurrency: {
      workflowPath: string;
      peerCount: number;
      peerWorkflowPaths: string[];
    }[];
    timeoutMinutes: {
      workflowPath: string;
      jobId: string;
      peerCount: number;
      peerJobLabels: string[];
    }[];
    dependencyCache: {
      workflowPath: string;
      jobId: string;
      peerCount: number;
      peerJobLabels: string[];
    }[];
    deepCheckout: {
      workflowPath: string;
      jobId: string;
      peerCount: number;
      peerJobLabels: string[];
    }[];
    pathsFilter: {
      workflowPath: string;
      peerCount: number;
      peerWorkflowPaths: string[];
    }[];
    nonCodeIgnore: {
      workflowPath: string;
      peerCount: number;
      peerWorkflowPaths: string[];
    }[];
    index: {
      concurrency: ReadonlyMap<
        string,
        {
          workflowPath: string;
          peerCount: number;
          peerWorkflowPaths: string[];
        }
      >;
      timeoutMinutes: ReadonlyMap<
        string,
        ReadonlyMap<
          string,
          {
            workflowPath: string;
            jobId: string;
            peerCount: number;
            peerJobLabels: string[];
          }
        >
      >;
      dependencyCache: ReadonlyMap<
        string,
        ReadonlyMap<
          string,
          {
            workflowPath: string;
            jobId: string;
            peerCount: number;
            peerJobLabels: string[];
          }
        >
      >;
      deepCheckout: ReadonlyMap<
        string,
        ReadonlyMap<
          string,
          {
            workflowPath: string;
            jobId: string;
            peerCount: number;
            peerJobLabels: string[];
          }
        >
      >;
      pathsFilter: ReadonlyMap<
        string,
        {
          workflowPath: string;
          peerCount: number;
          peerWorkflowPaths: string[];
        }
      >;
      nonCodeIgnore: ReadonlyMap<
        string,
        {
          workflowPath: string;
          peerCount: number;
          peerWorkflowPaths: string[];
        }
      >;
    };
  };
  repoPrecedents: RepositoryPrecedentSignals;
  eslint: {
    usesEslint: boolean;
    usesOxlint: boolean;
    hasConfig: boolean;
    pluginNames: string[];
    unsupportedPluginNames: string[];
    usesCustomExtensions: boolean;
    usesPrettierPlugin: boolean;
    usesPrettierRecommendedConfig: boolean;
    usesPrettierRule: boolean;
    usesImportPlugin: boolean;
    usesImportXPlugin: boolean;
    usesNoBarrelFilesPlugin: boolean;
    usesBarrelFilesPlugin: boolean;
  };
  prettier: {
    usesPrettier: boolean;
    usesOxfmt: boolean;
    hasConfig: boolean;
    pluginNames: string[];
    usesPrettierEslint: boolean;
  };
  python: {
    usesBlack: boolean;
    usesIsort: boolean;
    usesRuff: boolean;
    usesTox: boolean;
    usesNox: boolean;
  };
  nativePackages: {
    node: string[];
    python: string[];
  };
  npm: {
    npmrcFiles: string[];
    npmrcRelevantSettings: string[];
    lifecycleHookScripts: string[];
    packageScriptEnvReferences: string[];
    workflowEnvReferences: string[];
  };
  frameworks: {
    usesNextjs: boolean;
    nextjsVersionSpec?: string;
    nextjsMajor?: number;
    nextjsMinor?: number;
    nextjsPatch?: number;
    usesStorybook: boolean;
    storybookVersionSpec?: string;
    storybookMajor?: number;
    storybookMinor?: number;
    storybookPatch?: number;
    usesVite: boolean;
    usesAstro: boolean;
    usesSvelteKit: boolean;
    usesSolidStart: boolean;
    usesTurbo: boolean;
    usesNx: boolean;
    usesLerna: boolean;
    usesGradle: boolean;
    gradleBuildCacheConfigured: boolean;
    usesAngularCli: boolean;
    angularCliCacheEnabledForCi: boolean;
  };
  typescript: {
    versionSpec?: string;
    major?: number;
    minor?: number;
    isPublishingTypeDefinitions: boolean;
  };
  jest: {
    versionSpec?: string;
    major?: number;
    minor?: number;
    jsdomVersionSpec?: string;
    jsdomMajor?: number;
    jsdomEnvironmentVersionSpec?: string;
    jsdomEnvironmentMajor?: number;
  };
  tailwind: {
    usesTailwind: boolean;
    versionSpec?: string;
    major?: number;
    minor?: number;
    hasConfig: boolean;
    usesConfigPlugins: boolean;
    usesPostcssPlugin: boolean;
    usesVitePlugin: boolean;
    usesCliPackage: boolean;
    hasLegacyBrowserTargets: boolean;
  };
  husky: {
    usesHusky: boolean;
    usesLintStaged: boolean;
    hookFileCount: number;
    nonPreCommitHookCount: number;
    totalHookCommandCount: number;
    multiCommandHookCount: number;
    lintStagedPatternCount: number;
    lintStagedCommandCount: number;
    versionSpec?: string;
    major?: number;
    minor?: number;
    patch?: number;
    versionLocation?: SourceLocation;
    hookFiles: {
      path: string;
      content: string;
    }[];
  };
  rust: {
    hasCargoToml: boolean;
    hasWorkspace: boolean;
    workspaceMemberCount?: number;
    usesNextest: boolean;
  };
  hatch: {
    usesHatch: boolean;
    usesUvInstaller: boolean;
  };
  pdm: {
    usesPdm: boolean;
    usesUv: boolean;
  };
  babel: {
    usesBabel: boolean;
    versionSpec?: string;
    major?: number;
    hasConfig: boolean;
    configFileName?: string;
    presetNames: string[];
    pluginNames: string[];
    hasCustomPlugins: boolean;
    hasMacros: boolean;
    hasDecorators: boolean;
    hasEmotionPlugin: boolean;
    hasStyledComponentsPlugin: boolean;
    hasRelayPlugin: boolean;
    hasI18nPlugin: boolean;
    hasCoreJs: boolean;
    hasLegacyBrowserTargets: boolean;
  };
  elixir: {
    hasMixExs: boolean;
    hasToolVersions: boolean;
    erlangVersion?: string;
    elixirVersion?: string;
  };
}
