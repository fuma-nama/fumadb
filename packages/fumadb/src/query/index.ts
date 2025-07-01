import type { Column, Schema, Table, TypeMap } from "../schema/create";

export type AbstractTable<T extends Table = Table> = {
  [K in keyof T["columns"]]: AbstractColumn<ColumnValue<T["columns"][K]>>;
} & {
  _: AbstractTableInfo;
};

export class AbstractTableInfo {
  /**
   * Schema name (Not the actual name in SQL)
   */
  readonly name: string;
  readonly raw: Table;

  getIdColumnName() {
    for (const k in this.raw.columns) {
      const col = this.raw.columns[k]!;

      if ("id" in col && col.id) return k;
    }
  }

  constructor(name: string, table: Table) {
    this.name = name;
    this.raw = table;
  }
}

export class AbstractColumn<_Type = any> {
  parent: AbstractTableInfo;
  raw: Column;
  name: string;

  isID() {
    return "id" in this.raw && this.raw.id === true;
  }

  constructor(name: string, table: AbstractTableInfo, column: Column) {
    this.raw = column;
    this.parent = table;
    this.name = name;
  }

  getSQLName() {
    return `${this.parent.raw.name}.${this.raw.name}`;
  }
}

export type AnySelectClause = SelectClause<Schema, Table>;

export type SelectClause<S extends Schema, T extends Table> =
  | {
      [K in keyof S["tables"]]: SelectTable<S["tables"][K]>;
    }
  | SelectTable<T>;

type SelectTable<T extends Table> = true | (keyof T["columns"])[];

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

export enum ConditionType {
  And,
  Or,
  Compare,
  Not,
}

export type ConditionBuilder = {
  <T>(
    a: AbstractColumn<T>,
    operator: Operator,
    b: AbstractColumn<T> | T | null
  ): Condition;

  and: (...v: (Condition | boolean)[]) => Condition | boolean;
  or: (...v: (Condition | boolean)[]) => Condition | boolean;
  not: (v: Condition | boolean) => Condition | boolean;

  isNull: (a: AbstractColumn) => Condition;
  isNotNull: (a: AbstractColumn) => Condition;
};

function createBuilder(): ConditionBuilder {
  const builder: ConditionBuilder = (a, operator, b) => {
    if (!operators.includes(operator))
      throw new Error(`Unsupported operator: ${operator}`);

    return {
      type: ConditionType.Compare,
      a,
      b,
      operator,
    };
  };

  builder.isNull = (a) => builder(a, "is", null);
  builder.isNotNull = (a) => builder(a, "is not", null);
  builder.not = (condition) => {
    if (typeof condition === "boolean") return !condition;

    return {
      type: ConditionType.Not,
      item: condition,
    };
  };

  builder.or = (...conditions) => {
    const out = {
      type: ConditionType.Or,
      items: [] as Condition[],
    } as const;

    for (const item of conditions) {
      if (item === true) return true;
      if (item === false) continue;

      out.items.push(item);
    }

    if (out.items.length === 0) return false;
    return out;
  };

  builder.and = (...conditions) => {
    const out = {
      type: ConditionType.And,
      items: [] as Condition[],
    } as const;

    for (const item of conditions) {
      if (item === true) continue;
      if (item === false) return false;

      out.items.push(item);
    }

    if (out.items.length === 0) return true;
    return out;
  };

  return builder;
}

export type Condition =
  | {
      type: ConditionType.Compare;
      a: AbstractColumn;
      operator: Operator;
      b: AbstractColumn | unknown | null;
    }
  | {
      type: ConditionType.Or | ConditionType.And;
      items: Condition[];
    }
  | {
      type: ConditionType.Not;
      item: Condition;
    };

export const eb = createBuilder();

type TableToColumnValues<T extends Table> = {
  [K in keyof T["columns"]]: ColumnValue<T["columns"][K]>;
};

type ColumnValue<T extends Column> = T["nullable"] extends true
  ? TypeMap[T["type"]] | null
  : TypeMap[T["type"]];

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

type SelectTableResult<
  S extends SelectTable<T>,
  T extends Table
> = S extends true
  ? TableToColumnValues<T>
  : S extends (keyof T["columns"])[]
  ? Pick<TableToColumnValues<T>, S[number]>
  : never;

type SelectResult<
  S extends Schema,
  T extends Table,
  Select extends SelectClause<S, T>
> = Select extends SelectTable<T>
  ? SelectTableResult<Select, T>
  : {
      [K in keyof Select]: Select[K] extends SelectTable<infer $T>
        ? SelectTableResult<Select[K], $T>
        : never;
    };

export type OrderBy = [column: AbstractColumn, "asc" | "desc"];

export type FindFirstOptions<Select = AnySelectClause> = Omit<
  FindManyOptions<Select>,
  "limit"
>;

export interface FindManyOptions<Select = AnySelectClause> {
  select: Select;
  where?: (eb: ConditionBuilder) => Condition | boolean;

  offset?: number;
  limit?: number;
  orderBy?: OrderBy | OrderBy[];
}

export interface AbstractQuery<S extends Schema> {
  findFirst: {
    <T extends Table, Select extends SelectClause<S, T>>(
      from: AbstractTable<T>,
      v: FindFirstOptions<Select>
    ): Promise<SelectResult<S, T, Select> | null>;
  };

  findMany: {
    <T extends Table, Select extends SelectClause<S, T>>(
      from: AbstractTable<T>,
      v: FindManyOptions<Select>
    ): Promise<SelectResult<S, T, Select>[]>;
  };

  // not every database supports returning in update/delete, hence they will not be implemented.
  // TODO: maybe reconsider this in future

  updateMany: {
    <T extends Table>(
      from: AbstractTable<T>,
      v: {
        where?: (eb: ConditionBuilder) => Condition | boolean;
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

  create: {
    <T extends Table>(
      table: AbstractTable<T>,
      values: TableToInsertValues<T>
    ): Promise<TableToColumnValues<T>>;
  };

  deleteMany: {
    <T extends Table>(
      table: AbstractTable<T>,
      v: {
        where?: (eb: ConditionBuilder) => Condition | boolean;
      }
    ): Promise<void>;
  };

  get tables(): {
    [K in keyof S["tables"]]: AbstractTable<S["tables"][K]>;
  };
}
