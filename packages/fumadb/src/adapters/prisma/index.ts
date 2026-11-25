import type { MongoClient } from "mongodb";
import { createId } from "../../cuid";
import { column, idColumn, table } from "../../schema";
import type { PrismaClient } from "../../shared/prisma";
import type { Provider } from "../../shared/providers";
import type { FumaDBAdapter } from "..";
import { mergeSchemas } from "../../schema/merge";
import { generateSchema } from "./generate";
import { fromPrisma } from "./query";

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
  },
): FumaDBAdapter {
  const config = options as PrismaConfig;
  const settingsModel = (namespace: string) => `private_${namespace}_settings`;

  return {
    name: "prisma",
    createORM(schema) {
      return fromPrisma(schema, config);
    },
    async getSchemaVersion() {
      const prisma = config.prisma;
      const settings = settingsModel(this.namespace);
      if (!(settings in prisma)) return;

      // the schema version is the default value of `value` in the generated Prisma schema,
      // which Prisma doesn't expose at runtime, read it from a temporary row instead.
      const key = `version-${createId()}`;
      const result = await prisma[settings].create({ data: { key } });
      await prisma[settings].delete({ where: { key } });

      return result.value as string;
    },
    generateSchema(libraries, name) {
      const schemas = libraries.map(({ schema, context }) => {
        const settings = settingsModel(context.namespace);
        const internalTable = table(settings, {
          key: idColumn("key", "varchar(255)"),
          value: column("value", "string").defaultTo(schema.version),
        });
        internalTable.ormName = settings;

        return { ...schema, tables: { ...schema.tables, [settings]: internalTable } };
      });

      return {
        code: generateSchema(
          mergeSchemas(schemas, (table) => table.names.prisma),
          config.provider,
        ),
        path: `./prisma/schema/${name}.prisma`,
      };
    },
  };
}
