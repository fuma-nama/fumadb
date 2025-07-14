import { parseVarchar } from "../../utils/parse";
import { AnySchema, AnyTable, IdColumn } from "../create";

export interface ConvexConfig {
  type: "convex";
}

export function generateSchema(
  schema: AnySchema,
  config: ConvexConfig
): string {
  throw new Error("Not implemented");
}
