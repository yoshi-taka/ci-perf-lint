/** Guards for JSON values crossing into fuzz targets.
 *
 * `JSON.parse` can return any JSON value, not just an object. Fuzz targets that
 * read fields from the result must narrow it first; these helpers are the
 * single place that does so.
 */
export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse `text` and return it only when it is a plain JSON object. */
export function parseJsonObject(text: string): JsonObject | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isJsonObject(parsed) ? parsed : undefined;
}
