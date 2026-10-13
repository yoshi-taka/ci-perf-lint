import {
  hasShellInputDocument,
  parseBootstrapInvocation,
  shellCommandSegments,
  shellCommands,
  staticShellWords,
} from "./command-patterns.ts";

const valueOptions = new Set([
  "--app",
  "-a",
  "--context",
  "-c",
  "--profile",
  "--plugin",
  "--output",
  "-o",
  "--role-arn",
  "-r",
  "--proxy",
  "--ca-bundle-path",
  "--require-approval",
  "--parameters",
  "--tags",
  "--toolkit-stack-name",
  "--toolkit-bucket-name",
  "--bootstrap-bucket-name",
  "--bootstrap-kms-key-id",
  "--cloudformation-execution-policies",
  "--trust",
  "--trust-for-lookup",
  "--qualifier",
  "--custom-permissions-boundary",
  "--permissions-boundary",
  "--template",
  "--outputs-file",
  "--method",
  "-m",
  "--change-set-name",
  "--concurrency",
  "--asset-build-concurrency",
  "--asset-publishing-concurrency",
  "--notification-arns",
]);
const booleanOptions = new Set([
  "--all",
  "--exclusively",
  "-e",
  "--force",
  "-f",
  "--ci",
  "--verbose",
  "-v",
  "--debug",
  "--trace",
  "--strict",
  "--lookups",
  "--staging",
  "--path-metadata",
  "--asset-metadata",
  "--version-reporting",
  "--notices",
  "--color",
  "--json",
  "--execute",
  "--rollback",
  "--hotswap",
  "--hotswap-fallback",
  "--watch",
  "--logs",
  "--import-existing-resources",
  "--revert-drift",
  "--asset-parallelism",
  "--bootstrap-customer-key",
  "--example-permissions-boundary",
  "--use-previous-template",
  "--show-template",
  "--termination-protection",
  "--previous-parameters",
]);

interface CdkDeploymentCommand {
  verb: string;
  expressEnabled: boolean;
  methodConfigured: boolean;
  assetBuildConcurrencyConfigured: boolean;
  changeSetRequired: boolean;
}

function parseCdkDeploymentCommand(words: string[]): CdkDeploymentCommand | undefined {
  let verb: string | undefined;
  let enabled = false;
  let methodConfigured = false;
  let assetBuildConcurrencyConfigured = false;
  let changeSetNamed = false;
  let importExistingResources = false;
  let revertDrift = false;
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!;
    if (word === "--") {
      break;
    }
    const attachedMethod = /^-m[^=]/.test(word);
    const name = attachedMethod ? "-m" : word.split("=", 1)[0]!;
    if (name === "--express" || name === "--no-express") {
      const value = word.includes("=")
        ? word.slice(word.indexOf("=") + 1)
        : ["true", "false"].includes(words[index + 1] ?? "")
          ? words[++index]
          : undefined;
      if (value !== undefined && value !== "true" && value !== "false") {
        return undefined;
      }
      enabled = name === "--express" && value !== "false";
    } else if (valueOptions.has(name)) {
      const value = attachedMethod
        ? word.slice(2)
        : word.includes("=")
          ? word.slice(word.indexOf("=") + 1)
          : words[++index];
      if (!value) {
        return undefined;
      }
      methodConfigured ||= name === "--method" || name === "-m";
      assetBuildConcurrencyConfigured ||= name === "--asset-build-concurrency";
      changeSetNamed ||= name === "--change-set-name";
    } else if (["--help", "-h", "--version"].includes(word)) {
      return undefined;
    } else if (word.startsWith("-")) {
      const positive = name.replace(/^--no-/, "--");
      if (!booleanOptions.has(positive)) {
        return undefined;
      }
      const value = word.includes("=")
        ? word.slice(word.indexOf("=") + 1)
        : ["true", "false"].includes(words[index + 1] ?? "")
          ? words[++index]
          : undefined;
      if (positive === "--import-existing-resources" || positive === "--revert-drift") {
        if (value !== undefined && value !== "true" && value !== "false") {
          return undefined;
        }
        const active = !name.startsWith("--no-") && value !== "false";
        if (positive === "--import-existing-resources") {
          importExistingResources = active;
        } else {
          revertDrift = active;
        }
      }
    } else {
      verb ??= word;
    }
  }
  if (!verb || !["deploy", "destroy", "bootstrap"].includes(verb)) {
    return undefined;
  }
  return {
    verb,
    expressEnabled: enabled,
    methodConfigured,
    assetBuildConcurrencyConfigured,
    changeSetRequired: changeSetNamed || importExistingResources || revertDrift,
  };
}

function collectCdkDeploymentCommands(text: string): CdkDeploymentCommand[] {
  if (
    /\$\(|`/.test(text) ||
    hasShellInputDocument(text) ||
    shellCommands(text).some((words) =>
      ["if", "then", "else", "for", "while", "until", "case", "function"].includes(words[0] ?? ""),
    )
  ) {
    return [];
  }
  const commands: CdkDeploymentCommand[] = [];
  for (const segment of shellCommandSegments(text)) {
    let words = staticShellWords(segment);
    if (!words) {
      continue;
    }
    if (words[0] === "env") {
      words.shift();
    }
    while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) {
      words.shift();
    }
    // Resolve known bootstrap runners without flattening quoted option values.
    const bootstrapWords = words.map((word) =>
      /^(?:cdk|aws-cdk)@[^\s]+$/.test(word) ? word.split("@", 1)[0]! : word,
    );
    const invocation = parseBootstrapInvocation(
      bootstrapWords.map((word) => JSON.stringify(word)).join(" "),
    );
    if (invocation) {
      words = staticShellWords(invocation.command) ?? [];
    } else if (["pnpm", "yarn"].includes(words[0] ?? "") && words[1] === "exec") {
      words = words.slice(2);
    }
    const executable = (words[0] ?? "").replace(/\\/g, "/").split("/").at(-1);
    if (/^(?:cdk|aws-cdk)(?:\.cmd)?$/.test(executable ?? "")) {
      const command = parseCdkDeploymentCommand(words);
      if (command) {
        commands.push(command);
      }
    }
  }
  return commands;
}

export function textHasCdkCommandWithoutExpress(text: string): boolean {
  return collectCdkDeploymentCommands(text).some((command) => !command.expressEnabled);
}

export function textHasCdkDeployCommandWithoutMethod(text: string): boolean {
  return collectCdkDeploymentCommands(text).some(
    (command) =>
      command.verb === "deploy" && !command.methodConfigured && !command.changeSetRequired,
  );
}

export function textHasCdkDeployCommandWithoutAssetBuildConcurrency(text: string): boolean {
  return collectCdkDeploymentCommands(text).some(
    (command) => command.verb === "deploy" && !command.assetBuildConcurrencyConfigured,
  );
}
