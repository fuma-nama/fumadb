import { importGenerator } from "../../utils/import-generator";
import { ident, parseVarchar } from "../../utils/parse";
import { Schema, Table } from "../create";
import { Provider } from "../../shared/providers";

export interface TypeORMConfig {
  type: "typeorm";
  provider: Exclude<Provider, "mongodb">;
}

function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

// TODO: Support mongodb
export function generateSchema(schema: Schema, config: TypeORMConfig): string {
  const { provider } = config;
  const code: string[] = [];
  const imports = importGenerator();
  imports.addImport("Entity", "typeorm");

  function generateTable(table: Table) {
    const lines: string[] = [];
    const className = toPascalCase(table.name);

    // Add entity decorator
    lines.push(`@Entity("${table.name}")`);
    lines.push(`export class ${className} {`);

    // Generate columns
    for (const [key, column] of Object.entries(table.columns)) {
      const options: string[] = [];
      let type: string;

      // Handle column type
      switch (column.type) {
        case "integer":
          type = "number";
          break;
        case "bigint":
          type = "bigint";
          break;
        case "bool":
          type = "boolean";
          break;
        case "json":
          type = "object";
          break;
        case "timestamp":
        case "date":
          type = "Date";
          break;
        case "decimal":
          type = "number";
          break;
        default:
          type = "string";
          if (column.type.startsWith("varchar")) {
            const length = parseVarchar(column.type);

            if (length) {
              options.push(`length: ${length}`);
            }
          }
      }

      let decorator = "Column";
      // Add column decorator
      if (column.primarykey) {
        decorator =
          column.default === "autoincrement"
            ? "PrimaryGeneratedColumn"
            : "PrimaryColumn";
      }

      if (key !== column.name) {
        options.push(`name: "${column.name}"`);
      }

      if (column.nullable) {
        type += " | null";
        options.push(`nullable: true`);
      }

      if (typeof column.default === "object") {
        if ("sql" in column.default) {
          options.push(`default: () => "${column.default.sql}"`);
        } else {
          options.push(`default: ${JSON.stringify(column.default.value)}`);
        }
      } else if (column.default === "now") {
        options.push("default: () => 'CURRENT_TIMESTAMP'");
      }

      let arg = "";
      if (options.length > 0) {
        arg = `{\n${ident(options.join(",\n"))}\n}`;
      }

      imports.addImport(decorator, "typeorm");
      // Add property
      lines.push(ident(`@${decorator}(${arg})`));
      lines.push(`  ${key}: ${type};`);
      lines.push("");
    }

    lines.pop();
    lines.push("}");
    return lines.join("\n");
  }

  // Generate all tables
  for (const table of Object.values(schema.tables)) {
    code.push(generateTable(table));
  }

  code.unshift(imports.format());
  return code.join("\n\n");
}
