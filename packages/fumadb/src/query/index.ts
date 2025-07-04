import {
  IdColumn,
  type AnyColumn,
  type AnySchema,
  type AnyTable,
  type Relation,
} from "../schema/create";
import { type Condition, type ConditionBuilder } from "./condition-builder";

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

      if (col instanceof IdColumn) {
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
    return this.raw instanceof IdColumn;
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

export type SelectClause<T extends AnyTable> = true | (keyof T["columns"])[];

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

export type JoinBuilder<T extends AnyTable, Out = {}> = {
  [K in keyof T["relations"]]: T["relations"][K] extends Relation<
    infer Type,
    infer Target,
    infer Implied
  >
    ? <Select extends SelectClause<Target> = true, JoinOut = {}>(
        options?: Type extends "many"
          ? FindManyOptions<Target, Select, JoinOut, false>
          : FindFirstOptions<Target, Select, JoinOut, false>
      ) => JoinBuilder<
        T,
        Out & {
          [$K in K]: MapRelationType<
            SelectResult<Target, JoinOut, Select>,
            Implied
          >[Type];
        }
      >
    : never;
};

type SelectResult<
  T extends AnyTable,
  JoinOut,
  Select extends SelectClause<T>
> = MainSelectResult<Select, T> & JoinOut;

export type OrderBy = [column: AbstractColumn, "asc" | "desc"];

export type FindFirstOptions<
  T extends AnyTable = AnyTable,
  Select extends SelectClause<T> = SelectClause<T>,
  JoinOut = {},
  IsRoot extends boolean = true
> = Omit<
  FindManyOptions<T, Select, JoinOut, IsRoot>,
  IsRoot extends true ? "limit" : "limit" | "offset" | "orderBy"
>;

interface MapRelationType<Type, Implied extends boolean> {
  one: Implied extends true ? Type | null : Type;
  many: Type[];
}

export type FindManyOptions<
  T extends AnyTable = AnyTable,
  Select extends SelectClause<T> = SelectClause<T>,
  JoinOut = {},
  IsRoot extends boolean = true
> = {
  select?: Select;
  where?: (eb: ConditionBuilder) => Condition | boolean;

  limit?: number;
  orderBy?: OrderBy | OrderBy[];
  join?: (builder: JoinBuilder<T, {}>) => JoinBuilder<T, JoinOut>;
} & (IsRoot extends true
  ? {
      // drizzle doesn't support `offset` in join queries (this may be changed in future, we can add it back)
      offset?: number;
    }
  : {});

export interface AbstractQuery<S extends AnySchema> {
  findFirst: {
    <T extends AnyTable, JoinOut = {}, Select extends SelectClause<T> = true>(
      from: AbstractTable<T>,
      v: FindFirstOptions<T, Select, JoinOut>
    ): Promise<SelectResult<T, JoinOut, Select> | null>;
  };

  findMany: {
    <T extends AnyTable, JoinOut = {}, Select extends SelectClause<T> = true>(
      from: AbstractTable<T>,
      v: FindManyOptions<T, Select, JoinOut>
    ): Promise<SelectResult<T, JoinOut, Select>[]>;
  };

  // not every database supports returning in update/delete, hence they will not be implemented.
  // TODO: maybe reconsider this in future
  // TODO: implement upsert

  /**
   * Note: you cannot update the id of a row, some databases don't support that (including MongoDB).
   */
  updateMany: {
    <T extends AnyTable>(
      from: AbstractTable<T>,
      v: {
        where?: (eb: ConditionBuilder) => Condition | boolean;
        set: {
          [K in keyof T["columns"]]?: T["columns"][K] extends IdColumn
            ? never
            : T["columns"][K]["$out"];
        };
      }
    ): Promise<void>;
  };

  createMany: {
    <T extends AnyTable>(
      table: AbstractTable<T>,
      values: TableToInsertValues<T>[]
    ): Promise<void>;
  };

  /**
   * Note: when you don't need to receive the result, always use `createMany` for better performance.
   */
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
