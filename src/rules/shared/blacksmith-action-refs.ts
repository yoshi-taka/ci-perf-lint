// Verified against upstream release tags, 2026-11-24. Unknown pins remain unknown;
// workflow comments are not version evidence. No network resolution during audits.
const setupV2Pins = new Set([
  "33803e640bd9d674f2843a8c323aa2a7da478d23", // v2.0.0
  "1e75355f81cbb3f93cba1eb5dd5e5b05110ca8f9", // v2.0.1
  "a5256a73e30f09e37e3eceb8ca36043d17621d24", // v2.1.0
  "19215110ab936351210feebdfa5b440b4493e184", // v2.2.0
  "06dd9c83a5d541274d2e3ac67625560979275267", // v2.3.0
  "9657a6e02ca6445e6d6ce5ffaf370f4828dea50d", // v2.4.0
]);
const buildV2Pins = new Set([
  "cbd1f60d194a98cb3be5523b15134501eaf0fbf3", // v2.1.0
  "fb9e3e6a9299c78462bfadd0d93352c316adc9b8", // v2.2.0
  "9b0579bbec7a6cad2f171596c57e7ac1e7658850", // v2.3.0
]);

export function isBlacksmithV2Action(
  uses: string,
  action: "setup-docker-builder" | "build-push-action",
): boolean {
  const prefix = `useblacksmith/${action}@`;
  const normalized = uses.toLowerCase();
  if (!normalized.startsWith(prefix)) {
    return false;
  }
  const ref = normalized.slice(prefix.length);
  return (
    /^v2(?:\.\d+(?:\.\d+)?)?$/.test(ref) ||
    (action === "setup-docker-builder" ? setupV2Pins : buildV2Pins).has(ref)
  );
}
