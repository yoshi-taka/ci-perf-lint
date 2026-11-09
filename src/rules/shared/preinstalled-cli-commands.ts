import { shellNonDisplayInvocations } from "./shell-invocations.ts";
import { downloadCommandUrls } from "./download-command-arguments.ts";

export type PreinstalledCli = "aws" | "az" | "azcopy" | "gh" | "helm" | "jq" | "kubectl" | "yq";
const packageNames: Record<PreinstalledCli, string[]> = {
  aws: ["aws", "awscli"],
  az: ["azure-cli", "microsoft.azurecli"],
  azcopy: ["azcopy", "azcopy10"],
  gh: ["gh", "github.cli"],
  helm: ["helm", "kubernetes-helm"],
  jq: ["jq"],
  kubectl: ["kubectl", "kubernetes-cli"],
  yq: ["yq"],
};
const valueOptions = new Set([
  "--prefix",
  "--registry",
  "--root",
  "--target",
  "-t",
  "--index-url",
  "--extra-index-url",
  "--constraint",
  "-c",
  "--requirement",
  "-r",
  "--log",
  "--cache-dir",
  "--source",
  "--params",
  "--package-parameters",
  "--install-arguments",
  "--version",
  "--option",
  "-o",
  "--config-file",
  "--target-release",
  "-f",
]);

function installsPackage(words: string[], cli: PreinstalledCli): boolean {
  const [tool, action, ...args] = words;
  if (
    !["apt", "apt-get", "brew", "choco", "scoop", "winget", "pip", "pip3", "pipx", "snap"].includes(
      tool ?? "",
    ) ||
    action !== "install"
  ) {
    return false;
  }
  if (
    args.some(
      (arg) =>
        ["--help", "-h", "--version", "--dry-run", "--simulate"].includes(arg) &&
        !(arg === "--version" && tool === "choco"),
    )
  ) {
    return false;
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (valueOptions.has(arg)) {
      index++;
      continue;
    }
    const candidate = arg.startsWith("--id=") ? arg.slice(5) : arg;
    const name = candidate
      .toLowerCase()
      .split("/")
      .at(-1)
      ?.split(/[=@<>!~]/, 1)[0];
    if (name && packageNames[cli].includes(name)) {
      return true;
    }
  }
  return false;
}

export function cliInstallationCommands(text: string, cli: PreinstalledCli): string[][] {
  return shellNonDisplayInvocations(text, true).filter((words) => {
    if (installsPackage(words, cli)) {
      return true;
    }
    const [tool, action] = words;
    if (cli === "az" && tool === "az" && action === "upgrade") {
      return true;
    }
    if (cli === "aws" && tool === "./aws/install") {
      return true;
    }
    if (
      tool === `install-${cli}` ||
      (cli === "aws" && tool === "install-aws-cli") ||
      (cli === "helm" && tool === "get-helm-3") ||
      (cli === "az" && tool === "InstallAzureCLI")
    ) {
      return true;
    }
    return downloadCommandUrls(words).some(
      (url) =>
        (cli === "aws" && /^https:\/\/awscli\.amazonaws\.com\/awscli-/i.test(url)) ||
        (cli === "helm" && /\/get-helm-3(?:[?#]|$)/i.test(url)) ||
        (cli === "kubectl" && /^https:\/\/dl\.k8s\.io\//i.test(url)),
    );
  });
}

export function commandPinsCliVersion(words: string[], cli: PreinstalledCli): boolean {
  const urls = downloadCommandUrls(words);
  if (urls.length > 0) {
    return urls.some((url) => /(?:^|[/_-])v?\d+\.\d+(?:\.\d+)?(?:$|[/_.-])/.test(url));
  }
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!;
    if (
      ((word === "--version" || word === "-v") && /^v?\d/.test(words[index + 1] ?? "")) ||
      /^--version=v?\d/.test(word)
    ) {
      return true;
    }
    if (valueOptions.has(word)) {
      index++;
      continue;
    }
    if (
      packageNames[cli].some((name) =>
        ["==", "=", "@"].some((marker) => {
          const prefix = `${name}${marker}`;
          return word.toLowerCase().startsWith(prefix) && /^v?\d/.test(word.slice(prefix.length));
        }),
      )
    ) {
      return true;
    }
  }
  return false;
}
