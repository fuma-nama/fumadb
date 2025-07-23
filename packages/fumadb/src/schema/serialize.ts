import { sql } from "kysely";
import type { SQLProvider } from "../shared/providers";
import type { AnyColumn } from "./create";
import { createId } from "fumadb/cuid";

/**
 * Get the possible column types that the raw DB type can map to.
 */
export function dbToSchemaType(
  dbType: string,
  provider: SQLProvider
): (AnyColumn["type"] | "varchar(n)")[] {
  dbType = dbType.toLowerCase();
  if (provider === "sqlite") {
    switch (dbType) {
      case "integer":
        return ["bool", "date", "timestamp", "bigint", "integer"];
      case "text":
        return ["json", "string", "bigint", "varchar(n)"];
      case "real":
      case "numeric":
        return ["decimal"];
      case "blob":
        return ["bigint", "binary"];
      default:
        return [dbType as AnyColumn["type"]];
    }
  }

  if (provider === "postgresql" || provider === "cockroachdb") {
    switch (dbType) {
      case "decimal":
      case "real":
      case "numeric":
      case "double precision":
        return ["decimal"];
      case "timestamp":
      case "timestamptz":
        return ["timestamp"];
      case "varchar":
      case "text":
        return ["string", "varchar(n)"];
      case "boolean":
      case "bool":
        return ["bool"];
      case "bytea":
        return ["binary"];
      default:
        return [dbType as AnyColumn["type"]];
    }
  }

  if (provider === "mysql") {
    switch (dbType) {
      case "bool":
      case "boolean":
        return ["bool"];
      case "integer":
      case "int":
        return ["integer"];
      case "decimal":
      case "numeric":
      case "float":
      case "double":
        return ["decimal"];
      case "datetime":
        return ["timestamp"];
      case "varchar":
      case "text":
        return ["string", "varchar(n)"];
      case "longblob":
      case "blob":
      case "mediumblob":
      case "tinyblob":
        return ["binary"];
      default:
        return [dbType as AnyColumn["type"]];
    }
  }

  if (provider === "mssql") {
    switch (dbType) {
      case "int":
        return ["integer"];
      case "decimal":
      case "float":
      case "real":
      case "numeric":
        return ["decimal"];
      case "bit":
        return ["bool"];
      case "datetime":
      case "datetime2":
        return ["timestamp"];
      case "ntext":
      case "text":
      case "varchar(max)":
      case "nvarchar(max)":
      case "nvarchar":
      case "varchar":
        return ["string", "varchar(n)", "json"];
      case "binary":
      case "varbinary":
        return ["binary"];
      default:
        return [dbType as AnyColumn["type"]];
    }
  }

  throw new Error("unhandled database provider: " + provider);
}

export function schemaToDBType(
  column: AnyColumn | Pick<AnyColumn, "type">,
  provider: SQLProvider
): string {
  const { type } = column;

  if (provider === "sqlite") {
    switch (type) {
      case "integer":
      case "timestamp":
      case "date":
      case "bool":
        return "integer";
      case "binary":
      case "bigint":
        return "blob";
      case "json":
      case "string":
        return "text";
      case "decimal":
        return "real";
      default:
        // sqlite doesn't support varchar
        if (type.startsWith("varchar")) return "text";
    }
  }

  if (provider === "mssql") {
    switch (type) {
      case "bool":
        return "bit";
      case "timestamp":
        return "datetime";
      case "integer":
        return "int";
      case "string":
        return "varchar(max)";
      case "binary":
        return "varbinary(max)";
      // only 2025 preview supports JSON natively
      case "json":
        return "varchar(max)";
      default:
        if (type.startsWith("varchar")) return type as `varchar(${number})`;
        return type;
    }
  }

  if (provider === "postgresql" || provider === "cockroachdb") {
    switch (type) {
      case "bool":
        return "boolean";
      case "json":
        return "json";
      case "string":
        return "text";
      case "binary":
        return "bytea";
      default:
        if (type.startsWith("varchar")) return type as `varchar(${number})`;
        return type;
    }
  }

  if (provider === "mysql") {
    switch (type) {
      case "bool":
        return "boolean";
      case "string":
        return "text";
      case "binary":
        return "longblob";
      default:
        if (type.startsWith("varchar")) return type as `varchar(${number})`;
        return type;
    }
  }

  throw new Error(`cannot handle ${provider} ${type}`);
}

const supportJson: SQLProvider[] = ["postgresql", "cockroachdb", "mysql"];

/**
 * Parse from driver value
 */
export function deserialize(
  value: unknown,
  col: AnyColumn,
  provider: SQLProvider
) {
  if (value === null) return null;

  if (
    !supportJson.includes(provider) &&
    col.type === "json" &&
    typeof value === "string"
  ) {
    return JSON.parse(value);
  }

  if (
    provider === "sqlite" &&
    (col.type === "timestamp" || col.type === "date") &&
    (typeof value === "number" || typeof value === "string")
  ) {
    return new Date(value);
  }

  if (col.type === "bool" && typeof value === "number") return value === 1;

  if (col.type === "bigint" && value instanceof Buffer) {
    return value.readBigInt64BE(0);
  }

  if (col.type === "binary" && value instanceof Buffer) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return value;
}

/**
 * Encode to driver value
 */
export function serialize(
  value: unknown,
  col: AnyColumn,
  provider: SQLProvider
) {
  if (value === null) return null;

  if (!supportJson.includes(provider) && col.type === "json") {
    return JSON.stringify(value);
  }

  if (provider === "sqlite" && value instanceof Date) {
    return value.getTime();
  }

  if (provider === "sqlite" && typeof value === "boolean") return value ? 1 : 0;

  if (provider === "sqlite" && typeof value === "bigint") {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(value);
    return buf;
  }

  // most drivers accept Buffer
  if (col.type === "binary" && value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  return value;
}

export function getRuntimeDefaultValue(col: AnyColumn) {
  if (!col.default) return;

  if (col.default === "auto") return createId();
  if (col.default === "now") return new Date(Date.now());
  if ("value" in col.default) return col.default.value;
}

function isDefaultVirtual(column: AnyColumn, provider: SQLProvider) {
  return (
    // runtime generated cuid
    column.default === "auto" ||
    // MySQL doesn't support default value for TEXT
    (column.type === "string" && provider === "mysql")
  );
}

export function defaultValueToDB(column: AnyColumn, provider: SQLProvider) {
  const value = column.default;
  if (!value || isDefaultVirtual(column, provider)) return;

  if (value === "now") {
    return sql`CURRENT_TIMESTAMP`;
  } else if (typeof value === "object" && "sql" in value) {
    return sql.raw(value.sql);
  } else if (typeof value === "object" && "value" in value) {
    return sql.lit(value.value);
  }
}
