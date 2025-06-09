export interface Schema {
  version: string;
  tables: Record<string, Table>;
}

export interface Table {
  name: string;
  columns: Record<string, Column>;
  keys?: string[];
}

export interface TypeMap {
  serial: number;
  integer: number;
  decimal: number;
  date: Date;
  timestamp: Date;
  bigint: BigInt;
  bigserial: BigInt;
  uuid: string;
}

export type Column = BaseColumn &
  (
    | {
        type: "integer" | "decimal";
        default?:
          | "autoincrement"
          | {
              value: number;
            }
          | {
              sql: string;
            };
      }
    | {
        type: `varchar(${number})` | "string";
        default?:
          | {
              value: string;
            }
          | {
              sql: string;
            }
          | "mongodb_auto";
      }
    | {
        type: "bool";
        default?:
          | {
              value: boolean;
            }
          | {
              sql: string;
            };
      }
    | {
        type: "json";
        default?:
          | {
              value: unknown;
            }
          | {
              sql: string;
            };
      }
    | {
        type: "date" | "timestamp";
        default?:
          | {
              value: Date;
            }
          | {
              sql: string;
            }
          | "now";
      }
    | {
        type: "bigint";
        default?:
          | "autoincrement"
          | {
              value: BigInt;
            }
          | {
              sql: string;
            };
      }
  );

export interface BaseColumn {
  name: string;

  /**
   * @default false
   */
  nullable?: boolean;

  /**
   * As primary key
   */
  primarykey?: boolean;
}

export function schema<T extends Schema>(config: T): T {
  return config;
}

export function table<Columns extends Record<string, Column>>(
  name: string,
  columns: Columns,
  config: {
    /**
     * Not supported on MongoDB
     */
    keys?: (keyof Columns)[];
  } = {}
): {
  name: string;
  columns: Columns;
  keys?: string[];
} {
  const keys = config.keys as string[] | undefined;

  return {
    name,
    columns,
    keys,
  } satisfies Table;
}
