import { createId } from "../../cuid";
import { AnyColumn } from "../../schema/create";

// fallback to null otherwise the field will be missing
export function generateDefaultValue(col: AnyColumn) {
  if (!col.default) return null;

  if (col.default === "auto") {
    return createId();
  }

  if (col.default === "now") {
    return new Date(Date.now());
  }

  if ("value" in col.default) {
    return col.default.value;
  }

  return null;
}
