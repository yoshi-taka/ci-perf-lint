import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ci-perf-lint.veritycost.com/",
  integrations: [sitemap()],
});
