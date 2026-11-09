/** Literal URL operands, not header/body/output option values. Never fetch anything. */
export function downloadCommandUrls([tool, ...args]: string[]): string[] {
  if (!["curl", "wget", "aria2c"].includes(tool ?? "")) {
    return [];
  }
  const valueOptions = new Set([
    "-H",
    "--header",
    "-d",
    "--data",
    "--data-raw",
    "--data-binary",
    "--data-urlencode",
    "--post-data",
    "--post-file",
    "-o",
    "--output",
    "--output-document",
    "--out",
    "-A",
    "--user-agent",
    "-e",
    "--referer",
    "-u",
    "--user",
    "--proxy",
    "-x",
    "--cookie",
    "-b",
    "--cookie-jar",
    "-c",
    "--config",
    "-K",
  ]);
  const urls: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (
      ["--help", "-h", "--version", "-V", "--head", "--spider"].includes(arg) ||
      (tool === "curl" && arg === "-I")
    ) {
      return [];
    }
    if (arg === "--url") {
      const url = args[++index];
      if (url && /^(?:https?|ftp):\/\//i.test(url)) {
        urls.push(url);
      }
    } else if (arg.startsWith("--url=")) {
      const url = arg.slice(6);
      if (/^(?:https?|ftp):\/\//i.test(url)) {
        urls.push(url);
      }
    } else if (
      (valueOptions.has(arg) &&
        !(tool === "wget" && ["-c", "-d", "-b"].includes(arg)) &&
        !(tool === "aria2c" && arg === "-c")) ||
      (arg === "-O" && tool !== "curl")
    ) {
      index++;
    } else if (/^(?:https?|ftp):\/\//i.test(arg)) {
      urls.push(arg);
    }
  }
  return urls;
}
