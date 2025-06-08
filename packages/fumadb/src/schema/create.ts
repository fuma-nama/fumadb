export interface Schema {
  version: string;
  tables: Record<string, Table>;
}

export interface Table {
  name: string;
  columns: Record<string, Column>;
}

export type Column = BaseColumn &
  (
    | {
        type: "serial" | "integer" | "decimal";
        default?: number;
      }
    | {
        type: `varchar(${number})`;
        default?: string;
      }
    | {
        type: "bool";
        default?: boolean;
      }
    | {
        type: "json";
        default?: unknown;
      }
    | {
        type: "date" | "timestamp";
        default?: Date;
      }
    | {
        type: "bigint" | "bigserial";
        default?: BigInt;
      }
    | {
        type: "uuid";
        default?: string;
      }
  );

export interface BaseColumn {
  name: string;

  /**
   * @default false
   */
  nullable?: boolean;
}

export function table<Columns extends Record<string, Column>>(
  name: string,
  columns: Columns
): {
  name: string;
  columns: Columns;
} {
  return {
    name,
    columns,
  } satisfies Table;
}
