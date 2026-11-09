import { shellInvocations } from "./shell-invocations.ts";
import type { WorkflowStep } from "../../workflow.ts";

interface RailsCommand {
  tool: "rails" | "rake" | "rspec";
  args: string[];
  prefix: string;
}

/** Known Rails CLI/binstub invocations only; task names in output are data. */
export function railsCommands(text: string): RailsCommand[] {
  return shellInvocations(text, false).flatMap((words) => {
    let index = words[0] === "bundle" && words[1] === "exec" ? 2 : 0;
    if (words[index] === "--") {
      index++;
    }
    if (
      words[index] === "ruby" &&
      /^(?:\.\/)?bin\/(?:rails|rake|rspec)$/.test(words[index + 1] ?? "")
    ) {
      index++;
    }
    const tool = (words[index] ?? "").replace(/^(?:\.\/)?bin\//, "");
    if (tool !== "rails" && tool !== "rake" && tool !== "rspec") {
      return [];
    }
    const args = words.slice(index + 1);
    if (args.some((arg) => ["--help", "-h", "--version", "--dry-run"].includes(arg))) {
      return [];
    }
    return [{ tool, args, prefix: words.slice(0, index + 1).join(" ") }];
  });
}

export function railsCommandRunsTests(command: RailsCommand): boolean {
  return command.tool === "rspec" || /^(?:test|spec)(?::|$)/.test(command.args[0] ?? "");
}

export function stepHasRubyWorkflowEvidence(step: WorkflowStep): boolean {
  return (
    Boolean(step.uses?.toLowerCase().startsWith("ruby/setup-ruby@")) ||
    railsCommands(step.run ?? "").length > 0 ||
    shellInvocations(step.run ?? "", false).some(
      ([tool, action]) => tool === "bundle" && ["install", "exec"].includes(action ?? ""),
    )
  );
}
