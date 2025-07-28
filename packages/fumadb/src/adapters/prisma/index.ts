import type { MongoClient } from "mongodb";
import type { PrismaClient } from "../../shared/prisma";
import type { Provider } from "../../shared/providers";
import type { FumaDBAdapter } from "..";
import { fromPrisma } from "../../query/orm/prisma";
import { AbstractQuery } from "../../query";
import { generateSchema } from "./generate";

export interface PrismaConfig {
  provider: Provider;
  prisma: PrismaClient;

  /**
   * The relation mode you're using, see https://prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode.
   *
   * Default to foreign keys on SQL databases, and `prisma` on MongoDB.
   */
  relationMode?: "prisma" | "foreign-keys";

  /**
   * Underlying database instance, highly recommended to provide so FumaDB can optimize some operations & indexes.
   *
   * supported: MongoDB
   */
  db?: MongoClient;
}

export function prismaAdapter(
  options: Omit<PrismaConfig, "prisma"> & {
    prisma: unknown;
  }
): FumaDBAdapter {
  const config = options as PrismaConfig;

  return {
    createORM(schema) {
      return fromPrisma(schema, config) as AbstractQuery<any>;
    },
    generateSchema(schema, name) {
      return {
        code: generateSchema(schema, config.provider),
        path: `./prisma/schema/${name}.prisma`,
      };
    },
  };
}
