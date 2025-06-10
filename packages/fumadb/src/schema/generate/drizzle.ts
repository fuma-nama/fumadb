import { importGenerator } from "../../utils/import-generator";
import { parseVarchar } from "../../utils/parse";
import { Schema, Table } from "../create";
import { Provider } from "../providers";

export interface DrizzleConfig {
  type: "drizzle-orm";
  provider: Exclude<Provider, "cockroachdb" | "mongodb" | "sqlserver">;
}

export function generateSchema(schema: Schema, config: DrizzleConfig): string {
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

  function generateTable(tableKey: string, table: Table) {
    const cols: string[] = [];

    for (const [key, column] of Object.entries(table.columns)) {
      const col: string[] = [];

      // Handle column type
      let typeFn: string;
      const params: string[] = [];
      if (key !== column.name) {
        params.push(`"${column.name}"`);
      }

      switch (column.type) {
        case "integer":
          typeFn =
            provider !== "sqlite" && column.default === "autoincrement"
              ? "serial"
              : "integer";
          break;
        case "bigint":
          if (provider === "sqlite") {
            typeFn = "blob";
            params.push(`{ mode: "bigint" }`);
            break;
          }

          typeFn = column.default === "autoincrement" ? "bigserial" : "bigint";
          break;
        case "bool":
          if (provider === "sqlite") {
            params.push("{ mode: 'boolean' }");
            typeFn = "integer";
            break;
          }

          typeFn = "boolean";
          break;
        case "json":
          if (provider === "sqlite") {
            typeFn = "blob";
            params.push(`{ mode: "json" }`);
            break;
          }

          typeFn = "json";
          break;
        case "date":
          if (provider !== "sqlite") {
            typeFn = "date";
            break;
          }
        // for sqlite, generate dates as a timestamp
        case "timestamp":
          if (provider === "sqlite") {
            typeFn = "integer";
            params.push(`{ mode: "timestamp" }`);
            break;
          }

          typeFn = "timestamp";
          break;
        case "decimal":
          typeFn = provider === "sqlite" ? "real" : "decimal";
          break;
        default:
          if (column.type.startsWith("varchar")) {
            params.push(`{ length: ${parseVarchar(column.type)} }`);
            typeFn = provider === "sqlite" ? "text" : "varchar";
          } else {
            typeFn = "text";
          }
      }

      imports.addImport(typeFn, importSource);
      col.push(`${typeFn}(${params.join(", ")})`);

      // Handle primary key
      if (
        column.primarykey &&
        provider === "sqlite" &&
        column.default === "autoincrement"
      ) {
        col.push(`primaryKey({ autoIncrement: true })`);
      } else if (column.primarykey) {
        col.push("primaryKey()");
      }

      // Handle nullable
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

    const keys: string[] = [];
    if (table.keys && table.keys.length > 0) {
      imports.addImport("primaryKey", importSource);
      const columns = table.keys.map((key) => "table." + key).join(", ");
      keys.push(`  primaryKey({ columns: [${columns}] })`);
    }

    const args: string[] = [`"${table.name}"`];
    args.push(`{\n${cols.join(",\n")}\n}`);

    if (keys.length > 0) {
      args.push(`(table) => {\n${keys.join(",\n")}\n}`);
    }

    return `export const ${tableKey} = ${tableFn}(${args.join(", ")})`;
  }

  imports.addImport(tableFn, importSource);
  const lines: string[] = [];
  for (const [key, table] of Object.entries(schema.tables)) {
    lines.push(generateTable(key, table));
  }

  lines.unshift(imports.format());
  return lines.join("\n\n");
}
