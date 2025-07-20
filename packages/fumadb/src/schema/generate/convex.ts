import { AnySchema, AnyTable, AnyColumn, IdColumn } from "../create";
import { parseVarchar } from "../../utils/parse";

export interface ConvexConfig {
  type: "convex";
}

function mapColumnToValidator(column: AnyColumn, tableName: string): string {
  // Map FumaDB types to Convex validators
  let validator: string;
  if (column instanceof IdColumn) {
    // Convex id type: v.id("tableName")
    validator = `v.id("${tableName}")`;
  } else if (
    typeof column.type === "string" &&
    column.type.startsWith("varchar")
  ) {
    validator = "v.string()";
  } else {
    switch (column.type) {
      case "string":
        validator = "v.string()";
        break;
      case "integer":
      case "decimal":
        validator = "v.number()";
        break;
      case "bigint":
        validator = "v.int64()";
        break;
      case "bool":
        validator = "v.boolean()";
        break;
      case "json":
        validator = "v.any()";
        break;
      case "binary":
        validator = "v.bytes()";
        break;
      case "date":
      case "timestamp":
        validator = "v.number()"; // Convex stores timestamps as numbers
        break;
      default:
        validator = "v.any()";
    }
  }
  if (column.nullable) {
    validator = `v.optional(${validator})`;
  }
  return validator;
}

export function generateSchema(
  schema: AnySchema,
  config: ConvexConfig
): string {
  // Header imports
  const lines: string[] = [
    'import { defineSchema, defineTable } from "convex/server";',
    'import { v } from "convex/values";',
    "",
  ];

  // Table definitions
  const tableDefs: string[] = [];
  const tableNames: string[] = [];

  for (const [tableName, table] of Object.entries(schema.tables)) {
    tableNames.push(tableName);
    const fields: string[] = [];
    for (const [colName, column] of Object.entries(table.columns)) {
      const validator = mapColumnToValidator(column, tableName);
      fields.push(`  ${colName}: ${validator},`);
    }
    tableDefs.push(
      `const ${tableName}Table = defineTable({\n${fields.join("\n")}\n})` // indexes will be chained below
    );
  }

  // Indexes
  let tableIdx = 0;
  for (const table of Object.values(schema.tables)) {
    let indexLines = "";
    for (const colName in table.columns) {
      if (table.getIdColumn().ormName === colName) continue;

      indexLines += `\n  .index("by_${colName}", ["${colName}"])`;
    }
    tableDefs[tableIdx] += indexLines + ";\n";
    tableIdx++;
  }

  // Schema export
  lines.push(...tableDefs);
  lines.push("");
  lines.push(
    `export default defineSchema({\n${tableNames
      .map((t) => `  ${t}: ${t}Table,`)
      .join("\n")}\n});`
  );

  return lines.join("\n");
}
