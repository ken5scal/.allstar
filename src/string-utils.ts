/** Safe string for templates/logging from YAML/JSON unknown values (avoids `[object Object]`). */
export function stringFromUnknown(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "bigint"
  ) {
    return String(v);
  }
  return "";
}
