import type { PipelineStep } from "../../buildkite-workflow.ts";
import path from "node:path";

/** The Docker plugin mounts the checkout at workdir and starts there.
 * A workdir setting alone therefore does not change relative script paths. */
export function buildkiteAllowsCheckoutScripts(step: PipelineStep): boolean {
  return (step.plugins ?? []).every((plugin) =>
    Object.entries(plugin).every(([identifier, config]) => {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return true;
      }
      const options = config as Record<string, unknown>;
      if (["command", "entrypoint", "shell"].some((key) => Object.hasOwn(options, key))) {
        return false;
      }
      if (!/^(?:docker|buildkite-plugins\/docker)(?:#|$)/.test(identifier)) {
        return !Object.hasOwn(options, "workdir");
      }
      const mount = options["mount-checkout"];
      if (
        mount !== undefined &&
        mount !== true &&
        mount !== 1 &&
        !(typeof mount === "string" && ["true", "on", "1"].includes(mount))
      ) {
        return false;
      }
      const workdir = options.workdir ?? "/workdir";
      if (typeof workdir !== "string" || !workdir.startsWith("/") || /[$`\\]/.test(workdir)) {
        return false;
      }
      const root = path.posix.normalize(workdir).replace(/\/+$/, "") || "/";
      for (const key of ["volumes", "mounts", "tmpfs"]) {
        const values = options[key];
        if (values === undefined) {
          continue;
        }
        if (!Array.isArray(values)) {
          return false;
        }
        for (const value of values) {
          if (typeof value !== "string" || /[$`]/.test(value)) {
            return false;
          }
          const destination = key === "tmpfs" ? value.split(":")[0] : value.split(":")[1];
          if (!destination || !destination.startsWith("/")) {
            return false;
          }
          const target = path.posix.normalize(destination).replace(/\/+$/, "") || "/";
          if (
            root === "/" ||
            target === "/" ||
            root === target ||
            target.startsWith(`${root}/`) ||
            root.startsWith(`${target}/`)
          ) {
            return false;
          }
        }
      }
      return true;
    }),
  );
}
