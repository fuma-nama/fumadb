import { AnySchema } from "../create";
import * as Prisma from "./prisma";
import * as Drizzle from "./drizzle";
import * as TypeORM from "./type-orm";
import * as Convex from "./convex";

export type GenerateConfig =
  | Drizzle.DrizzleConfig
  | TypeORM.TypeORMConfig
  | Prisma.PrismaConfig
  | Convex.ConvexConfig;

/**
 * Generate schema for different ORMs.
 *
 * We don't want to implement the migrator, it's best for us to leverage existing solutions.
 */
export function generateSchema(
  schema: AnySchema,
  config: GenerateConfig
): string {
  if (config.type === "prisma") {
    return Prisma.generateSchema(schema, config);
  }

  if (config.type === "drizzle-orm") {
    return Drizzle.generateSchema(schema, config);
  }

  if (config.type === "typeorm") {
    return TypeORM.generateSchema(schema, config);
  }

  if (config.type === "convex") {
    return Convex.generateSchema(schema, config);
  }

  throw new Error(`Unsupported ORM: ${(config as any).type}`);
}
