import { AnySchema } from "../create";

export interface ConvexConfig {
  type: "convex";
}

export function generateSchema(
  schema: AnySchema,
  config: ConvexConfig
): string {
  throw new Error("Not implemented");
}
