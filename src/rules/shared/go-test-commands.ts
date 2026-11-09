import { shellInvocations } from "./shell-invocations.ts";

const valueFlags = new Set([
  "-p",
  "-C",
  "-o",
  "-run",
  "-skip",
  "-bench",
  "-benchtime",
  "-count",
  "-timeout",
  "-parallel",
  "-cpu",
  "-shuffle",
  "-vet",
  "-coverprofile",
  "-coverpkg",
  "-covermode",
  "-tags",
  "-ldflags",
  "-gcflags",
  "-asmflags",
  "-mod",
  "-modfile",
  "-overlay",
  "-pkgdir",
  "-exec",
  "-jsonfile",
  "-list",
  "-fuzz",
  "-fuzztime",
  "-fuzzminimizetime",
]);
const booleanFlags = new Set([
  "-race",
  "-v",
  "-short",
  "-failfast",
  "-fullpath",
  "-json",
  "-benchmem",
  "-cover",
  "-a",
  "-asan",
  "-msan",
  "-work",
  "-x",
  "-trimpath",
  "-buildvcs",
  "-linkshared",
  "-h",
  "-help",
  "--help",
  "-n",
  "-c",
]);

interface GoTestCommand {
  flags: Map<string, string>;
  targets: string[];
}

/** Option values and test-binary arguments cannot supply Go flags or package targets. */
export function collectGoTestCommands(text: string): GoTestCommand[] {
  return shellInvocations(text, false).flatMap(([tool, action, ...args]) => {
    if (tool?.split("/").at(-1) !== "go" || action !== "test") {
      return [];
    }
    const flags = new Map<string, string>();
    const targets: string[] = [];
    let options = true;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "-args") {
        break;
      }
      if (options && arg === "--") {
        options = false;
        continue;
      }
      if (!options || !arg.startsWith("-")) {
        targets.push(arg);
        continue;
      }
      if (/^-p\d+$/.test(arg)) {
        flags.set("-p", arg.slice(2));
        continue;
      }
      const equals = arg.indexOf("=");
      const name = equals < 0 ? arg : arg.slice(0, equals);
      if (!valueFlags.has(name) && !booleanFlags.has(name)) {
        return [];
      }
      const value =
        equals >= 0 ? arg.slice(equals + 1) : valueFlags.has(name) ? args[++index] : "true";
      if (value === undefined || /[$`]/.test(value)) {
        return [];
      }
      flags.set(name, value);
    }
    if (["-h", "-help", "--help", "-list", "-n", "-c"].some((flag) => flags.has(flag))) {
      return [];
    }
    return [{ flags, targets }];
  });
}
