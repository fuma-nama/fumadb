import { importGenerator } from "../../utils/import-generator";
import { ident, parseVarchar } from "../../utils/parse";
import { AnyColumn, AnySchema, AnyTable, IdColumn } from "../create";
import { SQLProvider } from "../../shared/providers";
import { schemaToDBType } from "../serialize";

export interface DrizzleConfig {
  type: "drizzle-orm";
  provider: Exclude<SQLProvider, "cockroachdb" | "mssql">;
}

export function generateSchema(
  schema: AnySchema,
  config: DrizzleConfig
): string {
  const { provider } = config;
  const imports = importGenerator();
  const importSource = {
    mysql: "drizzle-orm/mysql-core",
    postgresql: "drizzle-orm/pg-core",
    sqlite: "drizzle-orm/sqlite-core",
  }[provider];

  const tableFn = {
    mysql: "mysqlTable",
    postgresql: "pgTable",
    sqlite: "sqliteTable",
  }[provider];

  const generatedCustomTypes = new Set<string>();
  function generateCustomType(
    name: string,
    options: {
      dataType: string;
      driverDataType: string;
      databaseDataType: string;

      fromDriverCode: string;
      toDriverCode: string;
    }
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
      fromDriverCode:
        "return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)",
      toDriverCode: `return value instanceof Buffer? value : Buffer.from(value)`,
    });

    if (code) lines.push(code);
    return name;
  }

  function getColumnTypeFunction(column: AnyColumn): {
    name: string;
    isCustomType?: boolean;
    params?: string[];
  } {
    if (provider === "sqlite") {
      switch (column.type) {
        case "bigint":
          return {
            name: "blob",
            params: [`{ mode: "bigint" }`],
          };
        case "bool":
          return {
            name: "integer",
            params: [`{ mode: "boolean" }`],
          };
        case "json":
          return { name: "blob", params: [`{ mode: "json" }`] };
        // for sqlite, generate dates as a timestamp
        case "timestamp":
        case "date":
          return { name: "integer", params: [`{ mode: "timestamp" }`] };
        case "decimal":
          return { name: "real" };
      }
    }

    switch (column.type) {
      case "string":
        return { name: "text" };
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

    for (const [key, column] of Object.entries(table.columns)) {
      const col: string[] = [];
      const typeFn = getColumnTypeFunction(column);
      // Handle column type
      const params: string[] = [`"${column.name}"`, ...(typeFn.params ?? [])];

      if (!typeFn.isCustomType) imports.addImport(typeFn.name, importSource);
      col.push(`${typeFn.name}(${params.join(", ")})`);

      if (column instanceof IdColumn) {
        col.push("primaryKey()");

        if (column.default === "auto") {
          imports.addImport("createId", "fumadb/cuid");
          col.push("$defaultFn(() => createId())");
        }
      }

      if (column.unique) {
        col.push("unique()");
      }

      if (!column.nullable) {
        col.push("notNull()");
      }

      // Handle default values
      if (column.default === "now") {
        col.push("defaultNow()");
      } else if (typeof column.default === "object") {
        if ("sql" in column.default) {
          imports.addImport("sql", "drizzle-orm");
          col.push(`default(sql\`${column.default.sql}\`)`);
        } else {
          const value = JSON.stringify(column.default.value);
          col.push(`default(${value})`);
        }
      }

      cols.push(`  ${key}: ${col.join(".")}`);
    }

    const args: string[] = [`"${table.name}"`];
    args.push(`{\n${cols.join(",\n")}\n}`);

    const keys: string[] = [];
    for (const config of table.foreignKeys) {
      const columns = config.columns.map((col) => `table.${col}`);
      const foreignColumns = config.referencedColumns.map(
        (col) => `${config.referencedTable}.${col}`
      );

      imports.addImport("foreignKey", importSource);
      let code = `foreignKey({
  columns: [${columns.join(", ")}],
  foreignColumns: [${foreignColumns.join(", ")}],
  name: "${config.name}"
})`;
      if (config?.onUpdate)
        code += `.onUpdate("${config.onUpdate.toLowerCase()}")`;

      if (config?.onDelete)
        code += `.onDelete("${config.onDelete.toLowerCase()}")`;

      keys.push(code);
    }

    if (keys.length > 0)
      args.push(`(table) => [\n${ident(keys.join(",\n"))}\n]`);

    return `export const ${table.ormName} = ${tableFn}(${args.join(", ")})`;
  }

  function generateRelation(table: AnyTable) {
    const cols: string[] = [];

    for (const name in table.relations) {
      const relation = table.relations[name];
      if (!relation) continue;

      const options: string[] = [`relationName: "${relation.id}"`];

      // only `many` doesn't require fields, references
      if (!relation.implied || relation.type === "one") {
        const fields: string[] = [];
        const references: string[] = [];
        for (const [left, right] of relation.on) {
          fields.push(`${table.ormName}.${left}`);
          references.push(`${relation.table.ormName}.${right}`);
        }

        options.push(
          `fields: [${fields.join(", ")}]`,
          `references: [${references.join(", ")}]`
        );
      }

      const args: string[] = [];
      args.push(relation.table.ormName);
      if (options.length > 0) args.push(`{\n${ident(options.join(",\n"))}\n}`);

      cols.push(ident(`${name}: ${relation.type}(${args.join(", ")})`));
    }

    if (cols.length === 0) return;
    imports.addImport("relations", "drizzle-orm");
    return `export const ${table.ormName}Relations = relations(${
      table.ormName
    }, ({ one, many }) => ({
${cols.join(",\n")}
}));`;
  }

  imports.addImport(tableFn, importSource);
  const lines: string[] = [];
  for (const table of Object.values(schema.tables)) {
    lines.push(generateTable(table));
    const relation = generateRelation(table);
    if (relation) lines.push(relation);
  }

  lines.unshift(imports.format());
  return lines.join("\n\n");
}
