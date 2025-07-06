import { parseVarchar } from "../../utils/parse";
import { AnySchema, AnyTable, ForeignKeyAction, IdColumn } from "../create";
import { Provider } from "../../shared/providers";

export interface PrismaConfig {
  type: "prisma";
  provider: Provider;
}

const foreignKeyActionMap: Record<ForeignKeyAction, string> = {
  "SET NULL": "SetNull",
  CASCADE: "Cascade",
  RESTRICT: "Restrict",
};

export function generateSchema(
  schema: AnySchema,
  config: PrismaConfig
): string {
  const { provider } = config;
  function generateTable(table: AnyTable) {
    const code: string[] = [`model ${table.name} {`];

    for (const [key, column] of Object.entries(table.columns)) {
      let type: string;
      const attributes: string[] = [];

      if (provider === "mongodb" && column instanceof IdColumn) {
        attributes.push(
          // for monogodb, it's forced to use `_id`.
          // since we don't need to interact with raw column names when querying with Prisma, it's fine.
          `@map("_id")`
        );
      } else if (key !== column.name) {
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

      if (column instanceof IdColumn) {
        attributes.push("@id");

        if (column.default === "auto") {
          attributes.push("@default(cuid())");
        }
      }

      if (typeof column.default === "object") {
        if ("sql" in column.default) {
          const encoded = JSON.stringify(column.default.sql);
          attributes.push(`@default(dbgenerated(${encoded}))`);
        } else {
          attributes.push(`@default(${JSON.stringify(column.default.value)})`);
        }
      } else if (column.default === "now") {
        attributes.push("@default(now())");
      }

      // Add nullable modifier if needed
      if (column.nullable) {
        type += "?";
      }

      code.push(`  ` + [key, type, ...attributes].join(" "));
    }

    for (const k in table.relations) {
      const relation = table.relations[k];
      if (!relation) continue;
      let type = relation.table.ormName;
      if (relation.type === "many") type += "[]";
      else if (relation.isImplied()) type += "?";

      if (relation.isImplied()) {
        code.push(`  ${relation.ormName} ${type}`);
        continue;
      }

      const args: string[] = [];
      const fields: string[] = [];
      const references: string[] = [];
      for (const [left, right] of relation.on) {
        fields.push(left);
        references.push(right);
      }
      args.push(
        `fields: [${fields.join(", ")}]`,
        `references: [${references.join(", ")}]`
      );
      const config = relation.foreignKeyConfig;

      if (config) {
        args.push(`onUpdate: ${foreignKeyActionMap[config.onUpdate]}`);
        args.push(`onDelete: ${foreignKeyActionMap[config.onDelete]}`);
      }

      code.push(`  ${relation.ormName} ${type} @relation(${args.join(", ")})`);
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
