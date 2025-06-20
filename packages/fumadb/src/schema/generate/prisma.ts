import { parseVarchar } from "../../utils/parse";
import { Schema, Table } from "../create";
import { Provider } from "../../shared/providers";

export interface PrismaConfig {
  type: "prisma";
  provider: Provider;
}

export function generateSchema(schema: Schema, config: PrismaConfig): string {
  const { provider } = config;
  function generateTable(table: Table) {
    const code: string[] = [`model ${table.name} {`];

    for (const [key, column] of Object.entries(table.columns)) {
      let type: string;
      const attributes: string[] = [];

      if (key !== column.name) {
        attributes.push(`@map("${column.name}")`);
      }

      switch (column.type) {
        case "integer":
          type = "Int";
          break;
        case "bigint":
          type = "BigInt";
          break;
        case "bool":
          type = "Boolean";
          break;
        case "json":
          type = "Json";
          break;
        case "timestamp":
        case "date":
          type = "DateTime";
          break;
        case "decimal":
          type = "Decimal";
          break;
        default:
          type = "String";

          if (column.type.startsWith("varchar")) {
            if (
              provider === "mysql" ||
              provider === "cockroachdb" ||
              provider === "postgresql" ||
              provider === "mssql"
            ) {
              attributes.push(`@db.VarChar(${parseVarchar(column.type)})`);
            }
          }
      }

      if (column.primarykey) {
        attributes.push("@id");

        if (provider === "mongodb") {
          attributes.push("@db.ObjectId");
        }
      }

      if (typeof column.default === "object") {
        if ("sql" in column.default) {
          const encoded = JSON.stringify(column.default.sql);
          attributes.push(`@default(dbgenerated(${encoded}))`);
        } else {
          attributes.push(`@default(${JSON.stringify(column.default.value)})`);
        }
      } else if (column.default === "autoincrement") {
        attributes.push("@default(autoincrement())");
      } else if (column.default === "now") {
        attributes.push("@default(now())");
      } else if (column.default === "mongodb_auto") {
        attributes.push("@default(auto())");
      }

      // Add nullable modifier if needed
      if (column.nullable) {
        type += "?";
      }

      code.push(`  ` + [key, type, ...attributes].join(" "));
    }

    if (table.keys && table.keys.length > 0) {
      code.push(`  @@id([${table.keys.join(", ")}])`);

      if (provider === "mongodb") {
        throw new Error("MongoDB does not support @@id");
      }
    }

    code.push("}");
    return code.join("\n");
  }

  const lines: string[] = [];
  for (const t of Object.values(schema.tables)) {
    lines.push(generateTable(t));
  }

  return lines.join("\n\n");
}
