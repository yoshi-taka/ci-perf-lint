import { buildSite } from "./src/build-site";

const result = await buildSite();
console.log(
  `[site] ${result.pages} pages, ${result.rules} rules, ${result.links} internal links checked → ${result.output}`,
);
