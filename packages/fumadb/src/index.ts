import type { AnySchema, AnyTable, NameVariants } from "./schema";
import type { LibraryConfig } from "./shared/config";
import type { AbstractQuery } from "./query";
import type { FumaDBAdapter } from "./adapters";
import type { Migrator } from "./schema/migrate";

export * from "./shared/config";
export * from "./shared/providers";

export interface FumaDB<Schemas extends AnySchema[] = AnySchema[]> {
  schemas: Schemas;
  adapter: FumaDBAdapter;

  readonly abstract: AbstractQuery<Schemas[number]>;
  /**
   * Kysely only
   */
  createMigrator: () => Promise<Migrator>;

  /**
   * ORM only
   */
  generateSchema: (
    version: Schemas[number]["version"] | "latest",
    name?: string
  ) => {
    code: string;
    path: string;
  };
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
  client: (adapter: FumaDBAdapter) => FumaDB<Schemas>;

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
    client(adapter) {
      const querySchema = schemas.at(-1)!;
      let query: AbstractQuery<AnySchema>;

      return {
        adapter,
        schemas,
        generateSchema(version, name = config.namespace) {
          if (!adapter.generateSchema)
            throw new Error("The adapter doesn't support schema API.");
          let schema;

          if (version === "latest") {
            schema = schemas.at(-1)!;
          } else {
            schema = schemas.find((schema) => schema.version === version);
            if (!schema) throw new Error("Invalid version: " + version);
          }

          return adapter.generateSchema(schema, name);
        },

        async createMigrator() {
          if (!adapter.kysely)
            throw new Error("Only Kysely support migrator API.");

          const { createMigrator } = await import("./schema/migrate");
          return createMigrator(config, adapter.kysely);
        },

        get abstract() {
          query ??= adapter.createORM(querySchema);
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
