import {
  type AnySchema,
  type AnyTable,
  type ForeignKeyAction,
  IdColumn,
  parseTableName,
  type UniqueConstraint,
} from "../../schema/create";
import type { Provider } from "../../shared/providers";
import { parseVarchar } from "../../utils/parse";

const foreignKeyActionMap: Record<ForeignKeyAction, string> = {
  "SET NULL": "SetNull",
  CASCADE: "Cascade",
  RESTRICT: "Restrict",
};

export function generateSchema(schema: AnySchema, provider: Provider): string {
  function generateTable(table: AnyTable) {
    const code: string[] = [`model ${table.names.prisma} {`];

    for (const column of Object.values(table.columns)) {
      let type: string;
      const attributes: string[] = [];

      function map(name: string) {
        if (column.names.prisma === name) return;
        attributes.push(`@map("${name}")`);
      }

      map(provider === "mongodb" ? column.names.mongodb : column.names.sql);

      switch (column.type) {
        case "uuid":
          type = "String";
          switch (provider) {
            case "postgresql":
            case "cockroachdb":
              attributes.push("@db.Uuid");
              break;
            case "mssql":
              attributes.push("@db.UniqueIdentifier");
              break;
            // MySQL, SQLite, MongoDB use String without db attribute
          }
          break;
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
        case "binary":
          type = "Bytes";
          break;
        default:
          type = "String";

          // same as other adapters, Prisma uses `varchar(191)` by default
          if (column.type === "string" && provider === "mysql") {
            attributes.push("@db.Text");
          }

          if (column.type.startsWith("varchar")) {
            const parsed = parseVarchar(column.type);

            switch (provider) {
              case "cockroachdb":
                attributes.push(`@db.String(${parsed})`);
                break;
              case "mysql":
              case "postgresql":
              case "mssql":
                attributes.push(`@db.VarChar(${parsed})`);
                break;
            }
          }
      }

      if (column instanceof IdColumn) {
        attributes.push("@id");
      }

      if (column.isUnique) {
        attributes.push(`@unique(map: "${column.getUniqueConstraintName()}")`);
      }

      if (column.default) {
        if ("value" in column.default && provider === "mysql" && column.type === "string") {
          // MySQL only accepts the expression form for default values of `text` columns
          const value = `'${String(column.default.value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
          attributes.push(`@default(dbgenerated(${JSON.stringify(`(${value})`)}))`);
        } else if ("value" in column.default) {
          attributes.push(`@default(${JSON.stringify(column.default.value)})`);
        } else if (column.default.runtime === "auto") {
          attributes.push("@default(cuid())");
        } else if (column.default.runtime === "now") {
          attributes.push("@default(now())");
        }
      }

      // Add nullable modifier if needed
      if (column.isNullable) {
        type += "?";
      }

      code.push(`  ${[column.names.prisma, type, ...attributes].join(" ")}`);
    }

    for (const relation of Object.values(table.relations)) {
      let type = relation.table.names.prisma;

      if (relation.implied) {
        if (relation.type === "many") type += "[]";
        else type += "?";

        code.push(`  ${relation.name} ${type} @relation("${relation.id}")`);
        continue;
      }

      const fields: string[] = [];
      const references: string[] = [];
      let isOptional = false;

      for (const [left, right] of relation.on) {
        const col = table.columns[left];
        const refCol = relation.table.columns[right];

        if (col.isNullable) isOptional = true;
        fields.push(col.names.prisma);
        references.push(refCol.names.prisma);
      }

      if (isOptional) type += "?";
      const config = relation.foreignKey!;
      code.push(
        `  ${relation.name} ${type} @relation(${[
          `"${relation.id}"`,
          `fields: [${fields.join(", ")}]`,
          `references: [${references.join(", ")}]`,
          `onUpdate: ${foreignKeyActionMap[config.onUpdate]}`,
          `onDelete: ${foreignKeyActionMap[config.onDelete]}`,
        ].join(", ")})`,
      );
    }

    function indexColumns(con: UniqueConstraint) {
      return con.columns
        .map((col) => {
          const length = provider === "mysql" ? con.length?.[col.ormName] : undefined;
          if (length === undefined) return col.names.prisma;

          return `${col.names.prisma}(length: ${length})`;
        })
        .join(", ");
    }

    for (const con of table.getUniqueConstraints("table")) {
      code.push(`@@unique([${indexColumns(con)}], map: "${con.name}")`);
    }

    for (const index of table.getIndexes()) {
      code.push(`@@index([${indexColumns(index)}], map: "${index.name}")`);
    }

    function mapTable(name: string) {
      if (table.names.prisma === name) return;
      code.push(`@@map("${name}")`);
    }

    if (provider === "mongodb") {
      mapTable(table.names.mongodb);
    } else {
      const { schema: dbSchema, name } = parseTableName(table.names.sql);
      mapTable(name);

      // with multiple schemas, Prisma requires the schema of every model, it is `public` by default
      if (multiSchema) code.push(`@@schema(${JSON.stringify(dbSchema ?? "public")})`);
    }

    code.push("}");
    return code.join("\n");
  }

  const multiSchema = Object.values(schema.tables).some(
    (table) => parseTableName(table.names.sql).schema !== undefined,
  );
  if (multiSchema && provider !== "postgresql" && provider !== "cockroachdb")
    throw new Error(`[FumaDB] Table schemas are not supported on ${provider}.`);

  const lines: string[] = [];
  for (const t of Object.values(schema.tables)) {
    lines.push(generateTable(t));
  }

  return lines.join("\n\n");
}
