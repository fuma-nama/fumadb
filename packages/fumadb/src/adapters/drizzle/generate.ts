import {
  type AnyColumn,
  type AnySchema,
  type AnyTable,
  IdColumn,
  parseTableName,
  type UniqueConstraint,
} from "../../schema/create";
import { schemaToDBType } from "../../schema/serialize";
import type { SQLProvider } from "../../shared/providers";
import { importGenerator } from "../../utils/import-generator";
import { ident, parseVarchar } from "../../utils/parse";
import type { RelationsVersion } from "./shared";

export function generateSchema(
  schema: AnySchema,
  provider: Exclude<SQLProvider, "cockroachdb">,
  relationsVersion: RelationsVersion = 1,
): string {
  const imports = importGenerator();
  const importSource = {
    mysql: "drizzle-orm/mysql-core",
    postgresql: "drizzle-orm/pg-core",
    sqlite: "drizzle-orm/sqlite-core",
    mssql: "drizzle-orm/mssql-core",
  }[provider];

  const tableFn = {
    mysql: "mysqlTable",
    postgresql: "pgTable",
    sqlite: "sqliteTable",
    mssql: "mssqlTable",
  }[provider];

  // MSSQL is only available on drizzle-orm 1.x, where the v1 `relations()` helper
  // moved to the `drizzle-orm/_relations` compat entry point.
  const relationsImportSource = provider === "mssql" ? "drizzle-orm/_relations" : "drizzle-orm";

  const schemaDeclarations = new Map<string, string>();
  /**
   * Reference to the schema declared with `pgSchema()`
   */
  function schemaRef(dbSchema: string) {
    if (provider !== "postgresql")
      throw new Error(`[FumaDB] Table schemas are not supported on ${provider}.`);
    const name = `${dbSchema.replace(/\W/g, "_")}Schema`;

    if (!schemaDeclarations.has(name)) {
      imports.addImport("pgSchema", importSource);
      // drizzle-kit only creates the schemas that are exported
      schemaDeclarations.set(name, `export const ${name} = pgSchema(${JSON.stringify(dbSchema)})`);
    }

    return name;
  }

  const generatedCustomTypes = new Set<string>();
  function generateCustomType(
    name: string,
    options: {
      dataType: string;
      driverDataType: string;
      databaseDataType: string;

      fromDriverCode: string;
      toDriverCode: string;
    },
  ) {
    if (generatedCustomTypes.has(name)) return;

    imports.addImport("customType", importSource);
    generatedCustomTypes.add(name);
    return `const ${name} = customType<
  {
    data: ${options.dataType};
    driverData: ${options.driverDataType};
  }
>({
  dataType() {
    return "${options.databaseDataType}";
  },
  fromDriver(value) {
    ${options.fromDriverCode}
  },
  toDriver(value) {
    ${options.toDriverCode}
  }
});`;
  }

  function generateBinary() {
    const name = "customBinary";
    // most Node.js based drivers return Buffer for binary data, make sure to convert them
    const code = generateCustomType(name, {
      dataType: "Uint8Array",
      driverDataType: "Buffer",
      databaseDataType: schemaToDBType({ type: "binary" }, provider),
      // ArrayBuffer: libsql 1.x (0.x used to Buffer-wrap). "" : nested RQB null blob.
      fromDriverCode: `if (value == null || (value as any) === "") return null as unknown as Uint8Array;
    return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)`,
      toDriverCode: `return value instanceof Buffer? value : Buffer.from(value)`,
    });

    if (code) lines.push(code);
    return name;
  }

  function generateSQLiteBigInt() {
    const name = "customBigInt";
    // drizzle-orm's SQLite `integer` has no bigint mode, store as integer like the other adapters
    const code = generateCustomType(name, {
      dataType: "bigint",
      driverDataType: "number | bigint",
      databaseDataType: "integer",
      fromDriverCode: "return BigInt(value)",
      toDriverCode: "return value",
    });

    if (code) lines.push(code);
    return name;
  }

  function generateUniqueIdentifier() {
    const name = "customUniqueIdentifier";
    // drizzle-orm/mssql-core has no built-in `uniqueidentifier` column type
    const code = generateCustomType(name, {
      dataType: "string",
      driverDataType: "string",
      databaseDataType: "uniqueidentifier",
      fromDriverCode: "return value",
      toDriverCode: "return value",
    });

    if (code) lines.push(code);
    return name;
  }

  function getColumnTypeFunction(column: AnyColumn): {
    name: string;
    isCustomType?: boolean;
    params?: string[];
  } {
    if (provider === "mssql") {
      switch (column.type) {
        case "uuid":
          return {
            name: generateUniqueIdentifier(),
            isCustomType: true,
          };
        case "string":
          return { name: "varchar", params: [`{ length: "max" }`] };
        case "bool":
          return { name: "bit" };
        case "timestamp":
          return { name: "datetime" };
        case "integer":
          return { name: "int" };
        case "bigint":
          return { name: "bigint", params: [`{ mode: "bigint" }`] };
        case "json":
          return { name: "nvarchar", params: [`{ length: "max", mode: "json" }`] };
        case "binary":
          return {
            name: generateBinary(),
            isCustomType: true,
          };
        default:
          if (column.type.startsWith("varchar")) {
            return {
              name: "varchar",
              params: [`{ length: ${parseVarchar(column.type)} }`],
            };
          }

          return { name: column.type };
      }
    }

    if (provider === "sqlite") {
      switch (column.type) {
        case "uuid":
          return { name: "text" };
        case "bigint":
          return { name: generateSQLiteBigInt(), isCustomType: true };
        case "bool":
          return {
            name: "integer",
            params: [`{ mode: "boolean" }`],
          };
        case "json":
          return { name: "text", params: [`{ mode: "json" }`] };
        // for sqlite, dates are stored as epoch milliseconds
        case "timestamp":
        case "date":
          return { name: "integer", params: [`{ mode: "timestamp_ms" }`] };
        case "decimal":
          return { name: "real" };
      }
    }

    switch (column.type) {
      case "uuid":
        if (provider === "postgresql") {
          return { name: "uuid" };
        } else if (provider === "mysql") {
          return {
            name: "char",
            params: [`{ length: 36 }`],
          };
        }
        return { name: "text" };
      case "string":
        return { name: "text" };
      case "bigint":
        return { name: "bigint", params: [`{ mode: "bigint" }`] };
      case "timestamp":
        if (provider === "mysql") return { name: "datetime", params: [`{ fsp: 3 }`] };
        return { name: "timestamp" };
      case "binary":
        return {
          name: generateBinary(),
          isCustomType: true,
        };
      case "bool":
        return { name: "boolean" };
      default:
        if (column.type.startsWith("varchar")) {
          return {
            name: provider === "sqlite" ? "text" : "varchar",
            params: [`{ length: ${parseVarchar(column.type)} }`],
          };
        }

        return { name: column.type };
    }
  }

  function generateTable(table: AnyTable) {
    const cols: string[] = [];

    for (const column of Object.values(table.columns)) {
      const col: string[] = [];
      const typeFn = getColumnTypeFunction(column);
      // Handle column type
      const params: string[] = [`"${column.names.sql}"`, ...(typeFn.params ?? [])];

      if (!typeFn.isCustomType) imports.addImport(typeFn.name, importSource);
      col.push(`${typeFn.name}(${params.join(", ")})`);

      const collation = column.collation?.[provider];
      if (collation && provider === "mysql") {
        col.push(`collate(${JSON.stringify(collation)})`);
      }

      if (column instanceof IdColumn) {
        col.push("primaryKey()");
      }

      if (!column.isNullable) {
        col.push("notNull()");
      }

      // Handle default values
      if (column.default) {
        if ("value" in column.default) {
          const value = JSON.stringify(column.default.value);
          col.push(`default(${value})`);
        } else if (column.default.runtime === "now") {
          // same as the Kysely migrator
          if (provider === "mssql") {
            col.push("defaultGetDate()");
          } else if (provider === "sqlite") {
            imports.addImport("sql", "drizzle-orm");
            col.push("default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`)");
          } else if (provider === "mysql" && column.type === "timestamp") {
            imports.addImport("sql", "drizzle-orm");
            col.push("default(sql`CURRENT_TIMESTAMP(3)`)");
          } else {
            col.push("defaultNow()");
          }
        }
        // runtime default functions (e.g. `auto`) are generated by FumaDB
      }

      cols.push(`  ${column.names.drizzle}: ${col.join(".")}`);
    }

    const { schema: dbSchema, name } = parseTableName(table.names.sql);
    const args: string[] = [JSON.stringify(name)];
    args.push(`{\n${cols.join(",\n")}\n}`);

    const keys: string[] = [];
    // like the Kysely engine, MSSQL uses soft foreign keys (`relationMode: "fumadb"`):
    // real ones cannot reference the filtered unique indexes we generate for it.
    const foreignKeys = provider === "mssql" ? [] : table.foreignKeys;
    for (const key of foreignKeys) {
      const referencedTable = key.referencedTable;

      const columns = key.columns.map((col) => `table.${col.names.drizzle}`);
      const foreignColumns = key.referencedColumns.map(
        (col) => `${referencedTable.names.drizzle}.${col.names.drizzle}`,
      );

      imports.addImport("foreignKey", importSource);
      let code = `foreignKey({
  columns: [${columns.join(", ")}],
  foreignColumns: [${foreignColumns.join(", ")}],
  name: "${key.name}"
})`;
      if (key?.onUpdate) code += `.onUpdate("${key.onUpdate.toLowerCase()}")`;

      if (key?.onDelete) code += `.onDelete("${key.onDelete.toLowerCase()}")`;

      keys.push(code);
    }

    // with prefix length on MySQL
    function indexColumns(con: UniqueConstraint) {
      return con.columns.map((col) => {
        const ref = `table.${col.names.drizzle}`;
        const length = provider === "mysql" ? con.length?.[col.ormName] : undefined;
        if (length === undefined) return ref;

        imports.addImport("sql", "drizzle-orm");
        return `sql\`\${${ref}}(${length})\``;
      });
    }

    // same as the Kysely migrator: unique constraints on PostgreSQL, unique indexes otherwise.
    // MSSQL unique constraints treat NULLs as duplicates, use filtered unique
    // indexes instead so duplicated null values stay allowed.
    for (const con of table.getUniqueConstraints()) {
      const fn = provider === "postgresql" ? "unique" : "uniqueIndex";
      imports.addImport(fn, importSource);
      const cols = con.columns.map((col) => `table.${col.names.drizzle}`);
      let code = `${fn}("${con.name}").on(${indexColumns(con).join(", ")})`;

      if (provider === "mssql") {
        imports.addImport("sql", "drizzle-orm");
        code += `.where(sql\`${cols.map((col) => `\${${col}} IS NOT NULL`).join(" AND ")}\`)`;
      }

      keys.push(code);
    }

    for (const index of table.getIndexes()) {
      imports.addImport("index", importSource);
      keys.push(`index("${index.name}").on(${indexColumns(index).join(", ")})`);
    }

    if (keys.length > 0) args.push(`(table) => [\n${ident(keys.join(",\n"))}\n]`);

    return `export const ${table.names.drizzle} = ${dbSchema ? `${schemaRef(dbSchema)}.table` : tableFn}(${args.join(", ")})`;
  }

  function generateRelationV1(table: AnyTable) {
    const cols: string[] = [];

    for (const relation of Object.values(table.relations)) {
      const options: string[] = [`relationName: "${relation.id}"`];

      // only `many` doesn't require fields, references
      if (!relation.implied || relation.type === "one") {
        const fields: string[] = [];
        const references: string[] = [];

        for (const [left, right] of relation.on) {
          fields.push(`${table.names.drizzle}.${table.columns[left].names.drizzle}`);
          references.push(
            `${relation.table.names.drizzle}.${relation.table.columns[right].names.drizzle}`,
          );
        }

        options.push(`fields: [${fields.join(", ")}]`, `references: [${references.join(", ")}]`);
      }

      const args: string[] = [];
      args.push(relation.table.names.drizzle);
      if (options.length > 0) args.push(`{\n${ident(options.join(",\n"))}\n}`);

      cols.push(ident(`${relation.name}: ${relation.type}(${args.join(", ")})`));
    }

    if (cols.length === 0) return;
    imports.addImport("relations", relationsImportSource);
    return `export const ${table.names.drizzle}Relations = relations(${
      table.names.drizzle
    }, ({ one, many }) => ({
${cols.join(",\n")}
}));`;
  }

  function generateRelationsV2() {
    const tables = Object.values(schema.tables);
    const tableNames = tables.map((t) => t.names.drizzle);
    const relationBlocks: string[] = [];

    for (const table of tables) {
      const cols: string[] = [];

      for (const relation of Object.values(table.relations)) {
        const options: string[] = [`alias: "${relation.id}"`];
        const relationFn =
          relation.type === "one"
            ? `r.one.${relation.table.names.drizzle}`
            : `r.many.${relation.table.names.drizzle}`;

        if (!relation.implied || relation.type === "one") {
          const fromCols: string[] = [];
          const toCols: string[] = [];

          for (const [left, right] of relation.on) {
            fromCols.push(`r.${table.names.drizzle}.${table.columns[left].names.drizzle}`);
            toCols.push(
              `r.${relation.table.names.drizzle}.${relation.table.columns[right].names.drizzle}`,
            );
          }

          if (fromCols.length === 1) {
            options.unshift(`from: ${fromCols[0]}`, `to: ${toCols[0]}`);
          } else {
            options.unshift(`from: [${fromCols.join(", ")}]`, `to: [${toCols.join(", ")}]`);
          }
        }

        cols.push(ident(`${relation.name}: ${relationFn}({\n${ident(options.join(",\n"))}\n})`));
      }

      if (cols.length === 0) continue;
      relationBlocks.push(ident(`${table.names.drizzle}: {\n${cols.join(",\n")}\n}`));
    }

    // always emit `relations`, drizzle 1.x requires it to enable query mode
    imports.addImport("defineRelations", "drizzle-orm");
    if (relationBlocks.length === 0)
      return `export const relations = defineRelations({ ${tableNames.join(", ")} })`;

    return `export const relations = defineRelations({ ${tableNames.join(", ")} }, (r) => ({
${relationBlocks.join(",\n")}
}))`;
  }

  const lines: string[] = [];
  for (const table of Object.values(schema.tables)) {
    if (!parseTableName(table.names.sql).schema) imports.addImport(tableFn, importSource);
    lines.push(generateTable(table));
    if (relationsVersion === 1) {
      const relation = generateRelationV1(table);
      if (relation) lines.push(relation);
    }
  }

  if (relationsVersion === 2) {
    const relations = generateRelationsV2();
    if (relations) lines.push(relations);
  }

  lines.unshift(imports.format(), ...schemaDeclarations.values());
  return lines.join("\n\n");
}
