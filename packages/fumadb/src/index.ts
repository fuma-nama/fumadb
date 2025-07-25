import {
  AnySchema,
  AnyTable,
  createMigrator,
  generateSchema,
  Migrator,
  NameVariants,
} from "./schema";
import { DatabaseConfig, LibraryConfig, PrismaConfig } from "./shared/config";
import { fromKysely } from "./query/orm/kysely";
import { AbstractQuery } from "./query";
import { fromPrisma } from "./query/orm/prisma";
import { fromDrizzle } from "./query/orm/drizzle";
import { fromTypeORM } from "./query/orm/type-orm";
import { fromMongoDB } from "./query/orm/mongodb";

export * from "./shared/config";
export * from "./shared/providers";

export type UserConfig = DatabaseConfig & {
  /**
   * The version of schema for querying, default to latest.
   */
  queryVersion?: string;
};

export interface FumaDB<Schemas extends AnySchema[] = AnySchema[]> {
  schemas: Schemas;
  options: UserConfig;

  readonly abstract: AbstractQuery<Schemas[number]>;
  /**
   * Kysely only
   */
  createMigrator: () => Promise<Migrator>;

  /**
   * ORM only
   */
  generateSchema: (
    version: Schemas[number]["version"] | "latest"
  ) => Promise<string>;
}

type NameVariantsConfig<Tables extends Record<string, AnyTable>> = {
  [K in keyof Tables as K extends string
    ? keyof Tables[K]["columns"] extends string
      ? `${K}.${keyof Tables[K]["columns"]}`
      : never
    : never]?: Partial<NameVariants>;
} & {
  [k in keyof Tables]?: Partial<NameVariants>;
};

export interface FumaDBFactory<Schemas extends AnySchema[]> {
  version: <T extends Schemas[number]["version"]>(target: T) => T;
  configure: (userConfig: UserConfig) => FumaDB<Schemas>;

  /**
   * Add prefix to table names.
   *
   * If true, use package's `namespace` as prefix.
   */
  prefix: (prefix: true | string) => FumaDBFactory<Schemas>;

  /**
   * Set name variants
   */
  names: (
    variants: NameVariantsConfig<Schemas[number]["tables"]>
  ) => FumaDBFactory<Schemas>;
}

export type InferFumaDB<Factory extends FumaDBFactory<any>> =
  Factory extends FumaDBFactory<infer Schemas> ? FumaDB<Schemas> : never;

export function fumadb<Schemas extends AnySchema[]>(
  config: LibraryConfig<Schemas>
): FumaDBFactory<Schemas> {
  const schemas = config.schemas;

  function applySchemaNameVariant(
    schema: AnySchema,
    names: NameVariantsConfig<Schemas[number]["tables"]>
  ) {
    for (const k in names) {
      const [tableName, colName] = k.split(".", 2) as [string, string?];
      const table = schema.tables[tableName];
      if (!table) continue;

      if (!colName) {
        if (names[k]) applyVariant(table.names, names[k]);
        continue;
      }

      const col = table.columns[colName];
      if (!col) continue;

      if (names[k]) applyVariant(col.names, names[k]);
    }
  }

  function applySchemaPrefix(schema: AnySchema, prefix: string) {
    if (prefix.length === 0) return;

    for (const table of Object.values(schema.tables)) {
      for (const [k, v] of Object.entries(table.names)) {
        table.names[k as keyof NameVariants] = prefix + v;
      }
    }
  }

  return {
    /**
     * a static type checker for schema versions
     */
    version(targetVersion) {
      return targetVersion;
    },

    names(variants) {
      for (const schema of schemas) {
        applySchemaNameVariant(schema, variants);
      }

      return this;
    },

    prefix(v) {
      const prefix = v === true ? config.namespace : v;
      for (const schema of schemas) applySchemaPrefix(schema, prefix);

      return this;
    },

    /**
     * Configure consumer-side integration
     */
    configure(userConfig) {
      const querySchema = schemas.at(-1)!;
      let query;
      if (userConfig.type === "kysely") {
        query = fromKysely(querySchema, userConfig);
      } else if (userConfig.type === "prisma") {
        query = fromPrisma(querySchema, userConfig as PrismaConfig);
      } else if (userConfig.type === "drizzle-orm") {
        query = fromDrizzle(querySchema, userConfig.db, userConfig.provider);
      } else if (userConfig.type === "typeorm") {
        query = fromTypeORM(
          querySchema,
          userConfig.source,
          userConfig.provider
        );
      } else if (userConfig.type === "mongodb") {
        query = fromMongoDB(querySchema, userConfig.client);
      }

      if (!query) throw new Error(`Invalid type: ${userConfig.type}`);

      return {
        options: userConfig,
        schemas,
        async generateSchema(version) {
          if (userConfig.type === "kysely")
            throw new Error("Kysely doesn't support schema API.");
          if (userConfig.type === "mongodb")
            throw new Error("MongoDB doesn't support schema API.");
          let schema;

          if (version === "latest") {
            schema = schemas.at(-1)!;
          } else {
            schema = schemas.find((schema) => schema.version === version);
            if (!schema) throw new Error("Invalid version: " + version);
          }

          return generateSchema(schema, userConfig);
        },

        async createMigrator() {
          if (userConfig.type !== "kysely")
            throw new Error("Only Kysely support migrator API.");

          return createMigrator(config, userConfig);
        },

        get abstract() {
          return query;
        },
      };
    },
  };
}

function applyVariant(original: NameVariants, apply: Partial<NameVariants>) {
  for (const [k, v] of Object.entries(apply)) {
    if (v === undefined) continue;

    original[k as keyof NameVariants] = v;
  }
}
