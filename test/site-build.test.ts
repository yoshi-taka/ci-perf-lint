import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSite } from "../site/src/build-site";
import { createSiteHandler, watchSiteSources } from "../site/src/server";
import { validateSite } from "../site/src/validate";
import { testTempRoot } from "./temp-root";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(testTempRoot(), "site-"));
  roots.push(root);
  await mkdir(path.join(root, "docs/rules"), { recursive: true });
  await cp(path.resolve(import.meta.dir, "../site/public"), path.join(root, "site/public"), {
    recursive: true,
  });
  for (const slug of ["source-import-audit", "docker-cache-mount-persistence"]) {
    await writeFile(path.join(root, `docs/${slug}.md`), `# ${slug}\n\nGuide.\n`);
  }
  await writeFile(path.join(root, "docs/rules/README.md"), "# Not a rule");
  const rule = path.join(root, "docs/rules/example.md");
  await writeFile(rule, "# Example\n\nFirst summary.\n\nWhy it matters:\n\nEvidence.\n");
  const output = path.join(root, "site/dist");
  const page = (name: string) => readFile(path.join(output, name), "utf8");
  return { root, rule, output, page, build: () => buildSite({ rootDir: root }) };
}

test("fresh builds reflect added, edited, renamed, and deleted rule docs everywhere", async () => {
  const f = await fixture();
  expect((await f.build()).rules).toBe(1);
  expect(await f.page("rules/index.html")).toContain("First summary.");
  expect(await f.page("rules/example/index.html")).toContain('id="why-it-matters"');
  expect(await Bun.file(path.join(f.output, "rules/README/index.html")).exists()).toBe(false);
  await writeFile(f.rule, "# Updated title\n\nUpdated summary.\n\n## New section\n\nNew body.\n");
  const added = path.join(f.root, "docs/rules/added-rule.md");
  await writeFile(added, "# Added rule\n\n[Updated](example.md#new-section)\n");
  expect((await f.build()).rules).toBe(2);
  const index = await f.page("rules/index.html");
  expect(index).toContain("Updated title");
  expect(index).toContain("Updated summary.");
  expect(index).not.toContain("First summary.");
  expect(await f.page("rules/example/index.html")).toContain('href="#new-section"');
  expect(await f.page("rules/added-rule/index.html")).toContain(
    'href="/rules/example/#new-section"',
  );
  expect(await f.page("sitemap-0.xml")).toContain("/rules/added-rule/");

  await rename(added, path.join(f.root, "docs/rules/renamed-rule.md"));
  await rm(f.rule);
  await writeFile(path.join(f.root, "docs/rules/renamed-rule.md"), "# Renamed\n\nCurrent.\n");
  await writeFile(path.join(f.output, "obsolete.js"), "stale");
  await f.build();
  for (const name of ["rules/added-rule/index.html", "rules/example/index.html", "obsolete.js"]) {
    expect(await Bun.file(path.join(f.output, name)).exists()).toBe(false);
  }
  expect(await f.page("rules/index.html")).toContain("/rules/renamed-rule/");
  expect(await f.page("sitemap-0.xml")).not.toContain("/rules/added-rule/");
  expect(await f.page("sitemap-0.xml")).not.toContain("/rules/example/");
  expect(await f.page("sitemap-0.xml")).not.toContain("404.html");
});

test("broken references fail builds without replacing the last successful output", async () => {
  const f = await fixture();
  await f.build();
  const before = await f.page("rules/example/index.html");
  await writeFile(f.rule, "# Broken\n\n[Missing](missing-rule.md)\n");
  expect(String(await f.build().catch((error: unknown) => error))).toContain(
    "Site link validation failed",
  );
  expect(await f.page("rules/example/index.html")).toBe(before);
  await writeFile(f.rule, "# Fixed\n\nCurrent.\n");
  await f.build();
  expect(await f.page("rules/example/index.html")).toContain("Fixed");
});

test("link validator detects missing assets and anchors, and accepts valid routes", async () => {
  const pages = new Map([
    ["/", '<h1 id="top">Home</h1><a href="#top">Top</a><script src="/site.js"></script>'],
  ]);
  expect(await validateSite(pages, new Set(["/site.js"]), "https://example.com/")).toBe(2);
  expect(
    String(
      await validateSite(pages, new Set(), "https://example.com/").catch((error: unknown) => error),
    ),
  ).toContain("missing /site.js");
  pages.set("/", '<a href="#absent">Broken</a>');
  expect(
    String(
      await validateSite(pages, new Set(), "https://example.com/").catch((error: unknown) => error),
    ),
  ).toContain("missing /#absent");
});

test("preview serves assets, canonical directories, HEAD, and actual 404 responses", async () => {
  const f = await fixture();
  await f.build();
  const handle = createSiteHandler(f.output);
  const request = (route: string, method = "GET") =>
    handle(new Request(`http://localhost${route}`, { method }));
  expect((await request("/rules/example/")).status).toBe(200);
  expect((await request("/site.js")).headers.get("content-type")).toContain("javascript");
  expect((await request("/rules/example")).status).toBe(301);
  const missing = await request("/not-a-rule/");
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain("This page doesn’t exist.");
  expect(await (await request("/", "HEAD")).text()).toBe("");
  expect((await request("/", "POST")).status).toBe(405);
  expect((await request("/%00")).status).toBe(400);
  expect((await request("/.secret")).status).toBe(404);
});

test("watch mode rebuilds after rule add, edit, and deletion", async () => {
  const f = await fixture();
  await f.build();
  let next: (() => void) | undefined;
  const errors: unknown[] = [];
  const watcher = watchSiteSources(f.root, {
    rebuild: async () => {
      await f.build();
      next?.();
    },
    onError: (error) => {
      errors.push(error);
      next?.();
    },
  });
  async function change(action: () => Promise<unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const built = new Promise<void>((resolve, reject) => {
      next = resolve;
      timer = setTimeout(() => reject(new Error("Watch rebuild timed out")), 4000);
    });
    try {
      await action();
      await built;
    } finally {
      clearTimeout(timer);
      next = undefined;
    }
  }
  try {
    await change(() => writeFile(f.rule, "# Watched edit\n\nUpdated.\n"));
    expect(await f.page("rules/index.html")).toContain("Watched edit");
    const added = path.join(f.root, "docs/rules/watched-add.md");
    await change(() => writeFile(added, "# Watched add\n\nNew.\n"));
    expect(await f.page("rules/index.html")).toContain("Watched add");
    await change(() => rm(added));
    expect(await Bun.file(path.join(f.output, "rules/watched-add/index.html")).exists()).toBe(
      false,
    );
    expect(errors).toEqual([]);
  } finally {
    await watcher.close();
  }
}, 15000);
