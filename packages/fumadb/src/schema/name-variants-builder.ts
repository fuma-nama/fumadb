import { type AnySchema, type AnyTable, type NameVariants, parseTableName } from "./create";

export type NameVariantsConfig = Record<string, Partial<NameVariants>>;

type BuildNameVariants<Tables extends Record<string, AnyTable>> = {
  [
    K in keyof Tables as K extends string
      ? keyof Tables[K]["columns"] extends string
        ? `${K}.${keyof Tables[K]["columns"]}`
        : never
      : never
  ]?: Partial<NameVariants>;
} & {
  [k in keyof Tables]?: Partial<NameVariants>;
};

export type NameVariantsBuilder<Schemas extends AnySchema[], Out> = {
  (variants: BuildNameVariants<Schemas[number]["tables"]>): Out;

  <Version extends Schemas[number]["version"]>(
    versions: Version[],
    variants: BuildNameVariants<Extract<Schemas[number], { version: Version }>["tables"]>,
  ): Out;

  /**
   * Add prefix to table names.
   *
   * If true, use package's `namespace` as prefix.
   */
  prefix: (prefix: true | string) => Out;

  /**
   * Place tables in a database schema (e.g. PostgreSQL schema), same as setting the SQL name of tables to `schema.table`.
   */
  schema: (schema: string) => Out;
};

export function createNameVariantsBuilder<Schemas extends AnySchema[], Out>(
  namespace: string,
  schemas: Schemas,
  out: (schemas: Schemas) => Out,
) {
  const names = ((...args: [string[], NameVariantsConfig] | [NameVariantsConfig]) => {
    let updated: AnySchema[];

    if (args.length === 2) {
      const [versions, variants] = args;

      updated = schemas.flatMap((schema) => {
        if (!versions.includes(schema.version)) return [];

        return applyNameVariants(schema, variants);
      });
    } else {
      const [variants] = args;

      updated = schemas.map((schema) => applyNameVariants(schema, variants));
    }

    return out(updated as Schemas);
  }) as NameVariantsBuilder<Schemas, Out>;

  names.prefix = (prefix) => {
    if (prefix === true) prefix = namespace;

    return out(schemas.map((schema) => applyNameVariantsPrefix(schema, prefix)) as Schemas);
  };

  names.schema = (dbSchema) => {
    return out(
      schemas.map((schema) => {
        const generated: NameVariantsConfig = {};

        for (const [tableName, table] of Object.entries(schema.tables)) {
          generated[tableName] = { sql: `${dbSchema}.${parseTableName(table.names.sql).name}` };
        }

        return applyNameVariants(schema, generated);
      }) as Schemas,
    );
  };

  return names;
}

/**
 * Apply name variants prefix
 *
 * @returns a new schema
 */
export function applyNameVariantsPrefix(schema: AnySchema, prefix: string) {
  const generated: NameVariantsConfig = {};

  for (const [tableName, table] of Object.entries(schema.tables)) {
    const names: Record<string, string> = {};

    for (const [k, v] of Object.entries(table.names)) {
      names[k] = prefix + v;
    }

    // prefix the table name, not its schema
    const { schema: dbSchema, name } = parseTableName(table.names.sql);
    if (dbSchema) names.sql = `${dbSchema}.${prefix}${name}`;

    generated[tableName] = names;
  }

  return applyNameVariants(schema, generated);
}

/**
 * Apply name variants
 *
 * @returns a new schema
 */
export function applyNameVariants(schema: AnySchema, names: NameVariantsConfig): AnySchema {
  const cloned = schema.clone();

  for (const [k, v] of Object.entries(names)) {
    if (v === undefined) continue;

    const [tableName, colName] = k.split(".", 2) as [string, string?];
    const table = cloned.tables[tableName];
    if (!table) continue;

    if (!colName) {
      table.names = {
        ...table.names,
        ...v,
      };

      continue;
    }

    const col = table.columns[colName];
    if (!col) continue;

    col.names = { ...col.names, ...v };
  }

  return cloned;
}
