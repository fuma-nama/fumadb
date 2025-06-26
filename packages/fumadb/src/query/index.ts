import type { Column, Schema, Table } from "../schema/create";

export type AbstractTable<T extends Table = Table> = {
  [K in keyof T["columns"]]: AbstractColumn<ColumnValue<T["columns"][K]>>;
} & {
  _: AbstractTableInfo;
};

export class AbstractTableInfo {
  /**
   * Schema name (Not the actual name in SQL)
   */
  name: string;
  raw: Table;

  constructor(name: string, table: Table) {
    this.name = name;
    this.raw = table;
  }
}

export class AbstractColumn<Type = unknown> {
  parent: AbstractTableInfo;
  raw: Column;
  name: string;

  encode?: (v: Type) => unknown;
  decode?: (v: unknown) => Type;

  constructor(name: string, table: AbstractTableInfo, column: Column) {
    this.raw = column;
    this.parent = table;
    this.name = name;
  }

  getSQLName() {
    return `${this.parent.raw.name}.${this.raw.name}`;
  }
}

export type SelectClause = {
  [key: string]: AbstractColumn | SelectClause | AbstractTable;
};

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
  | [a: AbstractColumn, operator: Operator, b: AbstractColumn | unknown]
  | boolean
  | (Condition | "and")[]
  | (Condition | "or")[];

type TableToColumnValues<T extends Table> = {
  [K in keyof T["columns"]]: ColumnValue<T["columns"][K]>;
};

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

type SelectResult<Select extends SelectClause> = {
  [K in Exclude<keyof Select, "_">]: Select[K] extends AbstractColumn<
    infer Output
  >
    ? Output
    : Select[K] extends SelectClause
    ? SelectResult<Select[K]>
    : never;
};

export interface AbstractQuery<T extends Schema> {
  findFirst: {
    <T extends Table, Select extends SelectClause | true>(
      from: AbstractTable<T>,
      v: {
        select: Select;
        where?: Condition;
      }
    ): Select extends Record<string, AbstractColumn>
      ? Promise<SelectResult<Select> | null>
      : Promise<TableToColumnValues<T> | null>;
  };

  findMany: {
    <T extends Table, Select extends SelectClause | true>(
      from: AbstractTable<T>,
      v: {
        select: Select;
        where?: Condition;
      }
    ): Select extends Record<string, AbstractColumn>
      ? Promise<SelectResult<Select>[]>
      : Promise<TableToColumnValues<T>[]>;
  };

  // not every database supports returning in insert/update/delete, hence they will not be implemented.
  // TODO: maybe reconsider this in future

  updateMany: {
    <T extends Table>(
      from: AbstractTable<T>,
      v: {
        where?: Condition;
        set: Partial<TableToColumnValues<T>>;
      }
    ): Promise<void>;
  };

  createMany: {
    <T extends Table>(
      table: AbstractTable<T>,
      values: TableToInsertValues<T>[]
    ): Promise<void>;
  };

  deleteMany: {
    <T extends Table>(
      table: AbstractTable<T>,
      v: {
        where?: Condition;
      }
    ): Promise<void>;
  };

  get tables(): {
    [K in keyof T["tables"]]: AbstractTable<T["tables"][K]>;
  };
}
