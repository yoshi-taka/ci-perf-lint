import type { RepositorySignals } from "../repository-signals-types.ts";
import type { RestrictedImportRuleDefinition } from "./imports-direct-import-shared.ts";
import { createIconAndAssetImportRuleDefinitions } from "./imports-direct-import-rule-definitions-icons.ts";
import { createUiImportRuleDefinitions } from "./imports-direct-import-rule-definitions-ui.ts";
import { createUtilityImportRuleDefinitions } from "./imports-direct-import-rule-definitions-utilities.ts";

export function createRestrictedImportRuleDefinitions(
  repository: RepositorySignals,
  dependencyIndex: ReadonlySet<string>,
  usesMui: boolean,
): RestrictedImportRuleDefinition[] {
  return [
    ...createUiImportRuleDefinitions(repository, dependencyIndex, usesMui),
    ...createUtilityImportRuleDefinitions(dependencyIndex),
    ...createIconAndAssetImportRuleDefinitions(dependencyIndex),
  ];
}
