import { AbstractQuery, AbstractTable, Condition, SelectClause } from "..";
import { Schema, Table } from "../../schema";

export interface ORMAdapter {
  findOne: {
    (from: string, v: SelectClause): Promise<Record<string, unknown> | null>;
  };

  findMany: {
    (from: string, v: SelectClause): Promise<Record<string, unknown>[]>;
  };

  updateMany: {
    (
      from: string,
      v: {
        where?: Condition;
        set: Record<string, unknown>;
      }
    ): Promise<void>;
  };

  createOne: {
    (table: string, values: Record<string, unknown>): Promise<Record<
      string,
      unknown
    > | null>;
  };

  createMany: {
    (table: string, values: Record<string, unknown>[]): Promise<
      Record<string, unknown>[]
    >;
  };

  deleteOne: {
    (
      table: string,
      v: {
        where: Condition;
      }
    ): Promise<Record<string, unknown> | null>;
  };

  deleteMany: {
    (
      table: string,
      v: {
        where?: Condition;
      }
    ): Promise<void>;
  };
}

export function toORM<T extends Schema>(
  schema: T,
  adapter: ORMAdapter
): AbstractQuery<T> {
  const tables = Object.fromEntries(
    Object.entries(schema.tables).map(([k, v]) => [
      k,
      {
        ...v.columns,
        _: {
          name: v.name,
        },
      },
    ])
  );

  return {
    createMany(
      table: string | AbstractTable<Table>,
      values: Record<string, unknown>[]
    ) {
      if (typeof table === "string") {
        return adapter.createMany(table, values);
      }

      return adapter.createMany(table._.name, values);
    },
    createOne(
      table: string | AbstractTable<Table>,
      values: Record<string, unknown>
    ) {
      if (typeof table === "string") {
        return adapter.createOne(table, values);
      }

      return adapter.createOne(table._.name, values);
    },
    deleteOne(table: string | AbstractTable<Table>, v: { where: Condition }) {
      if (typeof table === "string") {
        return adapter.deleteOne(table, v);
      }

      return adapter.deleteOne(table._.name, v);
    },
    deleteMany(table: string | AbstractTable<Table>, v: { where?: Condition }) {
      if (typeof table === "string") {
        return adapter.deleteMany(table, v);
      }

      return adapter.deleteMany(table._.name, v);
    },
    findMany(table: string | AbstractTable<Table>, v: SelectClause) {
      if (typeof table === "string") {
        return adapter.findMany(table, v);
      }

      return adapter.findMany(table._.name, v);
    },
    findOne(table: string | AbstractTable<Table>, v: SelectClause) {
      if (typeof table === "string") {
        return adapter.findOne(table, v);
      }

      return adapter.findOne(table._.name, v);
    },
    updateMany(
      table: string | AbstractTable<Table>,
      v: { where?: Condition; set: Record<string, unknown> }
    ) {
      if (typeof table === "string") {
        return adapter.updateMany(table, v);
      }

      return adapter.updateMany(table._.name, v);
    },
    tables,
  } as AbstractQuery<T>;
}
