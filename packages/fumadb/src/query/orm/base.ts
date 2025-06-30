import {
  AbstractColumn,
  AbstractQuery,
  AbstractTable,
  AbstractTableInfo,
  Condition,
  eb,
  AnySelectClause,
} from "..";
import { Schema, Table } from "../../schema";

export interface ORMAdapter {
  tables: Record<string, AbstractTable>;

  findFirst: {
    (
      from: AbstractTable,
      v: {
        select: AnySelectClause;
        where?: Condition;
      }
    ): Promise<Record<string, unknown> | null>;
  };

  findMany: {
    (
      from: AbstractTable,
      v: {
        select: AnySelectClause;
        where?: Condition;
      }
    ): Promise<Record<string, unknown>[]>;
  };

  updateMany: {
    (
      from: AbstractTable,
      v: {
        where?: Condition;
        set: Record<string, unknown>;
      }
    ): Promise<void>;
  };

  create: {
    (table: AbstractTable, values: Record<string, unknown>): Promise<
      Record<string, unknown>
    >;
  };

  createMany: {
    (table: AbstractTable, values: Record<string, unknown>[]): Promise<void>;
  };

  deleteMany: {
    (
      table: AbstractTable,
      v: {
        where?: Condition;
      }
    ): Promise<void>;
  };

  mapTable?: (name: string, table: Table) => AbstractTable;
}

export function getAbstractTableKeys(table: AbstractTable) {
  const out: string[] = [];

  for (const k in table) {
    if (k !== "_") out.push(k);
  }

  return out;
}

export function createTables(
  schema: Schema,
  mapTable: (name: string, table: Table) => AbstractTable = (
    name: string,
    table: Table
  ) => {
    const mapped = {
      _: new AbstractTableInfo(name, table),
    } as AbstractTable;

    for (const k in table.columns) {
      mapped[k] = new AbstractColumn(k, mapped._, table.columns[k]!);
    }

    return mapped;
  }
) {
  return Object.fromEntries(
    Object.entries(schema.tables).map(([k, v]) => {
      return [k, mapTable(k, v)];
    })
  );
}

export function toORM<S extends Schema>(adapter: ORMAdapter): AbstractQuery<S> {
  return {
    async create(table, values) {
      return await adapter.create(table, values);
    },
    async createMany(table: AbstractTable, values) {
      await adapter.createMany(table, values);
    },
    async deleteMany(table: AbstractTable, { where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      await adapter.deleteMany(table, { where: conditions });
    },
    async findMany(table: AbstractTable, { select, where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return [];

      return await adapter.findMany(table, {
        select: select as AnySelectClause,
        where: conditions,
      });
    },
    async findFirst(table: AbstractTable, { select, where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return null;

      return await adapter.findFirst(table, {
        select: select as AnySelectClause,
        where: conditions,
      });
    },
    async updateMany(table: AbstractTable, { set, where }) {
      let conditions = where?.(eb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      return adapter.updateMany(table, { set, where: conditions });
    },
    tables: adapter.tables,
  } as AbstractQuery<S>;
}
