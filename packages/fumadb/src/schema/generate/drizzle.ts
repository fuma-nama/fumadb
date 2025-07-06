import { importGenerator } from "../../utils/import-generator";
import { ident, parseVarchar } from "../../utils/parse";
import { AnySchema, AnyTable, IdColumn } from "../create";
import { Provider } from "../../shared/providers";

export interface DrizzleConfig {
  type: "drizzle-orm";
  provider: Exclude<Provider, "cockroachdb" | "mongodb" | "mssql">;
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

  function generateTable(tableKey: string, table: AnyTable) {
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
          typeFn = "integer";
          break;
        case "bigint":
          if (provider === "sqlite") {
            typeFn = "blob";
            params.push(`{ mode: "bigint" }`);
            break;
          }

          typeFn = "bigint";
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

      if (column instanceof IdColumn) {
        col.push("primaryKey()");

        if (column.default === "auto") {
          imports.addImport("createId", "fumadb/cuid");
          col.push("$defaultFn(() => createId())");
        }
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
    for (const name in table.relations) {
      const relation = table.relations[name];
      if (!relation || relation.isImplied()) continue;
      const config = relation.foreignKeyConfig;
      const columns: string[] = [];
      const foreignColumns: string[] = [];

      for (const [left, right] of relation.on) {
        columns.push(`table.${left}`);
        foreignColumns.push(
          `${
            relation.table === table ? "table" : relation.table.ormName
          }.${right}`
        );
      }

      imports.addImport("foreignKey", importSource);
      let code = `foreignKey({
  columns: [${columns.join(", ")}],
  foreignColumns: [${foreignColumns.join(", ")}],
  name: "${relation.ormName}_fk"
})`;
      if (config?.onUpdate)
        code += `.onUpdate("${config.onUpdate.toLowerCase()}")`;

      if (config?.onDelete)
        code += `.onDelete("${config.onDelete.toLowerCase()}")`;

      keys.push(code);
    }

    if (keys.length > 0)
      args.push(`(table) => [\n${ident(keys.join(",\n"))}\n]`);

    return `export const ${tableKey} = ${tableFn}(${args.join(", ")})`;
  }

  function generateRelation(table: AnyTable) {
    const cols: string[] = [];

    for (const name in table.relations) {
      const relation = table.relations[name];
      if (!relation) continue;

      const options: string[] = [];
      const target = relation.table;

      if (!relation.isImplied()) {
        const fields: string[] = [];
        const references: string[] = [];
        for (const [left, right] of relation.on) {
          fields.push(`${table.ormName}.${left}`);
          references.push(`${target.ormName}.${right}`);
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
  for (const [key, table] of Object.entries(schema.tables)) {
    lines.push(generateTable(key, table));
    const relation = generateRelation(table);
    if (relation) lines.push(relation);
  }

  lines.unshift(imports.format());
  return lines.join("\n\n");
}
