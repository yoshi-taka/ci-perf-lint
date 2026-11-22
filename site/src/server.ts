import { watch } from "node:fs";
import path from "node:path";
import { PUBLIC_GUIDES } from "../config";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function createSiteHandler(outputDir: string) {
  const root = path.resolve(outputDir);
  const respond = (request: Request, file: ReturnType<typeof Bun.file>, status = 200) =>
    new Response(request.method === "HEAD" ? null : file, {
      status,
      headers: {
        "content-type":
          contentTypes[path.extname(file.name ?? "")] || file.type || "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  return async (request: Request): Promise<Response> => {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (/[\u0000-\u001f\u007f]/.test(pathname)) return new Response("Bad request", { status: 400 });
    const notFound = () => respond(request, Bun.file(path.join(root, "404.html")), 404);
    if (pathname.split("/").some((part) => part.startsWith("."))) return notFound();
    const filename = pathname.endsWith("/")
      ? `${pathname}index.html`
      : path.extname(pathname)
        ? pathname
        : `${pathname}/index.html`;
    const target = path.resolve(root, `.${filename}`);
    if (!target.startsWith(`${root}${path.sep}`)) return notFound();
    const file = Bun.file(target);
    if (!(await file.exists())) return notFound();
    if (!pathname.endsWith("/") && !path.extname(pathname)) {
      url.pathname = `${url.pathname}/`;
      return new Response(null, { status: 301, headers: { location: url.href } });
    }
    return respond(request, file);
  };
}

interface WatchOptions {
  rebuild: () => Promise<unknown>;
  onError: (error: unknown) => void;
}

// Serialize rebuilds and coalesce writes. A failed rebuild is recoverable;
// buildSite leaves the previously published output in place.
export function watchSiteSources(rootDir: string, { rebuild, onError }: WatchOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<void> | undefined;
  let again = false;
  let closed = false;
  function run() {
    if (closed) return;
    if (current) {
      again = true;
      return;
    }
    current = (async () => {
      do {
        again = false;
        try {
          await rebuild();
        } catch (error) {
          onError(error);
        }
      } while (again && !closed);
    })().finally(() => {
      current = undefined;
    });
  }
  function schedule() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(run, 75);
  }
  const watchers = [
    watch(path.join(rootDir, "docs"), { recursive: true, encoding: "utf8" }, (_, filename) => {
      const relative = filename?.split(path.sep).join("/");
      if (
        !relative ||
        /^rules\/[^/]+\.md$/.test(relative) ||
        PUBLIC_GUIDES.some((slug) => relative === `${slug}.md`)
      )
        schedule();
    }),
    watch(path.join(rootDir, "site/public"), { recursive: true, encoding: "utf8" }, schedule),
  ];
  for (const watcher of watchers) watcher.on("error", onError);
  return {
    async close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      await current;
    },
  };
}
