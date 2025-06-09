import { Schema } from "../create";
import { Provider } from "../providers";
import * as Prisma from "./prisma";
import * as Drizzle from "./drizzle";

interface TypeORMConfig {
  type: "type-orm";
  provider: Provider;
}

export type GenerateConfig =
  | Drizzle.DrizzleConfig
  | TypeORMConfig
  | Prisma.PrismaConfig;

/**
 * Generate schema for different ORMs.
 *
 * We don't want to implement the migrator, it's best for us to leverage existing solutions.
 */
export function generateSchema(schema: Schema, config: GenerateConfig): string {
  if (config.type === "prisma") {
    return Prisma.generateSchema(schema, config);
  }

  if (config.type === "drizzle-orm") {
    return Drizzle.generateSchema(schema, config);
  }

  throw new Error(`Unsupported ORM: ${config.type}`);
}
