import type { Column, Schema, Table } from "../schema/create";

interface SelectClause {
  select: true | Record<string, boolean>;
  where?: Condition;
}

type AbstractTable<T extends Table = Table> = {
  _: {
    name: string;
  };
} & T["columns"];

export type Operator = ">" | "<" | ">=" | "<=" | "=" | "!=";

export type Condition =
  | [a: Column, operator: Operator, b: unknown]
  | boolean
  | "and"
  | "or"
  | Condition[];

type TableToColumnValues<T extends Table> = {
  [K in keyof T["columns"]]: ColumnValue<T["columns"][K]>;
};

type TrueKeys<T extends Record<string, boolean>> = {
  [K in keyof T]: T[K] extends true ? K : never;
}[keyof T];

type ValueMap = {
  string: string;
  bigint: BigInt;
  integer: number;
  decimal: number;
  bool: boolean;
  json: unknown;
  date: Date;
  timestamp: Date;
} & Record<`varchar(${number})`, string>;

type ColumnValue<T extends Column> = T["nullable"] extends true
  ? ValueMap[T["type"]] | null
  : ValueMap[T["type"]];

export interface AbstractQuery<T extends Schema> {
  findOne: {
    <T extends Table, Select extends Record<keyof T["columns"], boolean> | "*">(
      from: AbstractTable<T>,
      v: {
        select: Select;
        where?: Condition;
      }
    ): Select extends Record<keyof T["columns"], boolean>
      ? TrueKeys<Select> extends string
        ? Promise<Pick<TableToColumnValues<T>, TrueKeys<Select>> | null>
        : never
      : Promise<TableToColumnValues<T> | null>;

    (from: string, v: SelectClause): Promise<unknown>;
  };

  get tables(): {
    [K in keyof T["tables"]]: AbstractTable<T["tables"][K]>;
  };
}

/**
 * Abstract layer to interact with database, focused on max compatibility.
 */
export function abstractQuery<T extends Schema>(schema: T): AbstractQuery<T> {
  return {} as unknown as AbstractQuery<T>;
}
