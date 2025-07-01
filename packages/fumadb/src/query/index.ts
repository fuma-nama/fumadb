import {
  type AnyColumn,
  type AnySchema,
  type AnyTable,
  type Relation,
  type RelationType,
} from "../schema/create";
import type { Condition, ConditionBuilder } from "./condition-builder";

export type AbstractTable<T extends AnyTable = AnyTable> = {
  [K in keyof T["columns"]]: AbstractColumn<T["columns"][K]>;
} & {
  _: AbstractTableInfo;
};

export class AbstractTableInfo {
  /**
   * Schema name (Not the actual name in SQL)
   */
  readonly name: string;
  readonly raw: AnyTable;
  readonly idColumnName: string;

  constructor(name: string, table: AnyTable) {
    this.name = name;
    this.raw = table;

    for (const k in this.raw.columns) {
      const col = this.raw.columns[k]!;

      if ("id" in col && col.id) {
        this.idColumnName = k;
        return;
      }
    }

    throw new Error("there's no id column in your table " + name);
  }
}

export class AbstractColumn<ColumnType extends AnyColumn = AnyColumn> {
  parent: AbstractTableInfo;
  raw: ColumnType;
  name: string;

  isID() {
    return "id" in this.raw && this.raw.id === true;
  }

  constructor(name: string, table: AbstractTableInfo, column: ColumnType) {
    this.raw = column;
    this.parent = table;
    this.name = name;
  }

  getSQLName() {
    return `${this.parent.raw.name}.${this.raw.name}`;
  }
}

export type AnySelectClause = SelectClause<AnyTable>;
export type AnyJoinClause = JoinClause<AnyTable>;

export type SelectClause<T extends AnyTable> = true | (keyof T["columns"])[];
export type JoinClause<T extends AnyTable> = Partial<{
  [K in keyof T["relations"]]: T["relations"][K] extends Relation<
    RelationType,
    infer Target
  >
    ? SelectClause<Target>
    : never;
}>;

type TableToColumnValues<T extends AnyTable> = {
  [K in keyof T["columns"]]: T["columns"][K]["$out"];
};

type PickNullable<T> = {
  [P in keyof T as null extends T[P] ? P : never]: T[P];
};

type PickNotNullable<T> = {
  [P in keyof T as null extends T[P] ? never : P]: T[P];
};

type TableToInsertValues<T extends AnyTable> = Partial<
  PickNullable<{
    [K in keyof T["columns"]]: T["columns"][K]["$in"];
  }>
> &
  PickNotNullable<{
    [K in keyof T["columns"]]: T["columns"][K]["$in"];
  }>;

type MainSelectResult<
  S extends SelectClause<T>,
  T extends AnyTable
> = S extends true
  ? TableToColumnValues<T>
  : S extends (keyof T["columns"])[]
  ? Pick<TableToColumnValues<T>, S[number]>
  : never;

type SelectResult<
  T extends AnyTable,
  Join extends JoinClause<T>,
  Select extends SelectClause<T>
> = MainSelectResult<Select, T> & {
  [K in keyof Join]: K extends keyof T["relations"]
    ? T["relations"][K] extends Relation<infer Type, infer Target>
      ? Join[K] extends SelectClause<Target>
        ? MapRelationType<MainSelectResult<Join[K], Target>>[Type]
        : never
      : never
    : never;
};

export type OrderBy = [column: AbstractColumn, "asc" | "desc"];

export type FindFirstOptions<
  T extends AnyTable = AnyTable,
  Select extends SelectClause<T> = SelectClause<T>,
  Join extends JoinClause<T> = JoinClause<T>
> = Omit<FindManyOptions<T, Select, Join>, "limit">;

type MapRelationType<Type> = {
  one: Type;
  "one?": Type | null | undefined;
  many: Type[];
};

export interface FindManyOptions<
  T extends AnyTable = AnyTable,
  Select extends SelectClause<T> = SelectClause<T>,
  Join extends JoinClause<T> = JoinClause<T>
> {
  select?: Select;
  where?: (eb: ConditionBuilder) => Condition | boolean;

  offset?: number;
  limit?: number;
  orderBy?: OrderBy | OrderBy[];
  join?: Join;
}

export interface AbstractQuery<S extends AnySchema> {
  findFirst: {
    <
      T extends AnyTable,
      Join extends JoinClause<T> = {},
      Select extends SelectClause<T> = true
    >(
      from: AbstractTable<T>,
      v: FindFirstOptions<T, Select, Join>
    ): Promise<SelectResult<T, Join, Select> | null>;
  };

  findMany: {
    <
      T extends AnyTable,
      Join extends JoinClause<T> = {},
      Select extends SelectClause<T> = true
    >(
      from: AbstractTable<T>,
      v: FindManyOptions<T, Select, Join>
    ): Promise<SelectResult<T, Join, Select>[]>;
  };

  // not every database supports returning in update/delete, hence they will not be implemented.
  // TODO: maybe reconsider this in future
  // TODO: implement upsert

  updateMany: {
    <T extends AnyTable>(
      from: AbstractTable<T>,
      v: {
        where?: (eb: ConditionBuilder) => Condition | boolean;
        set: Partial<TableToColumnValues<T>>;
      }
    ): Promise<void>;
  };

  createMany: {
    <T extends AnyTable>(
      table: AbstractTable<T>,
      values: TableToInsertValues<T>[]
    ): Promise<void>;
  };

  create: {
    <T extends AnyTable>(
      table: AbstractTable<T>,
      values: TableToInsertValues<T>
    ): Promise<TableToColumnValues<T>>;
  };

  deleteMany: {
    <T extends AnyTable>(
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
