import type { Column, Schema, Table } from "../schema/create";

export type AbstractTable<T extends Table = Table> = {
  _: {
    name: string;
  };
} & T["columns"];

/**
 * From Kysely, excluded operators that's exclusive to some databases.
 */
export const operators = [
  "=",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "in",
  "not in",
  "is",
  "is not",

  // replacement for `like` (Prisma doesn't support `like`)
  "contains",
  "starts with",
  "ends with",

  "not contains",
  "not starts with",
  "not ends with",

  // excluded `regexp` since MSSQL doesn't support it, may re-consider

  // JSON specific operators are not included, some databases don't support them
  // `match` requires additional extensions & configurations on SQLite and PostgreSQL
  // MySQL & SQLite requires workarounds to support `ilike`
  // containment operators such as `@>` are specific to PostgreSQL
  // `<=>` is specific to MySQL
] as const;

export type Operator = (typeof operators)[number];

export type Condition =
  | [
      a: Pick<Column, "name">,
      operator: Operator,
      b: Pick<Column, "name"> | unknown
    ]
  | boolean
  | (Condition | "and")[]
  | (Condition | "or")[];

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

type PickNullable<T> = {
  [P in keyof T as null extends T[P] ? P : never]: T[P];
};

type PickNotNullable<T> = {
  [P in keyof T as null extends T[P] ? never : P]: T[P];
};

type TableToInsertValuesWithoutOptional<T extends Table> = {
  [K in keyof T["columns"]]: null extends T["columns"][K]["default"]
    ? ColumnValue<T["columns"][K]>
    : ColumnValue<T["columns"][K]> | null;
};

type TableToInsertValues<T extends Table> = Partial<
  PickNullable<TableToInsertValuesWithoutOptional<T>>
> &
  PickNotNullable<TableToInsertValuesWithoutOptional<T>>;

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

    (
      from: string,
      v: {
        select: true | Record<string, boolean>;
        where: Condition;
      }
    ): Promise<Record<string, unknown> | null>;
  };

  findMany: {
    <T extends Table, Select extends Record<keyof T["columns"], boolean> | "*">(
      from: AbstractTable<T>,
      v: {
        select: Select;
        where?: Condition;
      }
    ): Select extends Record<keyof T["columns"], boolean>
      ? TrueKeys<Select> extends string
        ? Promise<Pick<TableToColumnValues<T>, TrueKeys<Select>>[]>
        : never
      : Promise<TableToColumnValues<T>[]>;

    (
      from: string,
      v: {
        select: true | Record<string, boolean>;
        where?: Condition;
      }
    ): Promise<Record<string, unknown>[]>;
  };

  // not every database supports returning in update, hence `updateOne` will not be implemented.
  // TODO: maybe reconsider this in future

  updateMany: {
    <T extends Table, Select extends Record<keyof T["columns"], boolean> | "*">(
      from: AbstractTable<T>,
      v: {
        where?: Condition;
        set: Partial<TableToColumnValues<T>>;
      }
    ): Promise<void>;

    (
      from: string,
      v: {
        where?: Condition;
        set: Record<string, unknown>;
      }
    ): Promise<void>;
  };

  createOne: {
    <T extends Table>(
      table: AbstractTable<T>,
      values: TableToInsertValues<T>
    ): Promise<TableToColumnValues<T> | null>;

    (table: string, values: Record<string, unknown>): Promise<Record<
      string,
      unknown
    > | null>;
  };

  createMany: {
    <T extends Table>(
      table: AbstractTable<T>,
      values: TableToInsertValues<T>[]
    ): Promise<TableToColumnValues<T>[]>;

    (table: string, values: Record<string, unknown>[]): Promise<void>;
  };

  deleteOne: {
    <T extends Table>(
      table: AbstractTable<T>,
      v: {
        where: Condition;
      }
    ): Promise<TableToColumnValues<T> | null>;

    (
      table: string,
      v: {
        where: Condition;
      }
    ): Promise<Record<string, unknown> | null>;
  };

  deleteMany: {
    <T extends Table>(
      table: AbstractTable<T>,
      v: {
        where?: Condition;
      }
    ): Promise<void>;

    (
      table: string,
      v: {
        where?: Condition;
      }
    ): Promise<void>;
  };

  get tables(): {
    [K in keyof T["tables"]]: AbstractTable<T["tables"][K]>;
  };
}
