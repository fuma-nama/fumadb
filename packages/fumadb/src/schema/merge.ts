import type { AnySchema, AnyTable } from "./create";

/**
 * Combine the schemas of several libraries, to generate their ORM schema into one file.
 *
 * @param identifier - the name of a table in the generated code, it must be unique like the SQL name
 */
export function mergeSchemas(
  schemas: AnySchema[],
  identifier: (table: AnyTable) => string,
): AnySchema {
  const tables: Record<string, AnyTable> = {};
  const sqlNames = new Set<string>();
  const identifiers = new Set<string>();

  schemas.forEach((schema, i) => {
    for (const table of Object.values(schema.tables)) {
      const id = identifier(table);

      if (sqlNames.has(table.names.sql) || identifiers.has(id)) {
        throw new Error(
          `[FumaDB] the table "${table.names.sql}" (${id}) is defined by more than one library, rename it with the names API.`,
        );
      }

      sqlNames.add(table.names.sql);
      identifiers.add(id);
      tables[`${i}:${table.ormName}`] = table;
    }
  });

  return { ...schemas[0]!, tables };
}
