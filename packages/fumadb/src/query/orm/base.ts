import {
  AbstractColumn,
  AbstractQuery,
  AbstractTable,
  AbstractTableInfo,
  AnySelectClause,
  FindFirstOptions,
  FindManyOptions,
  JoinBuilder,
  OrderBy,
  TransactionAbstractQuery,
} from "..";
import {
  buildCondition,
  builder as cb,
  ConditionType,
  type Condition,
} from "../condition-builder";
import { AnyRelation, AnySchema, AnyTable, ForeignKey } from "../../schema";

export interface CompiledJoin {
  relation: AnyRelation;
  options: SimplifyFindOptions<FindManyOptions> | false;
}

export interface SimplifiedCountOptions {
  where?: Condition | undefined;
}

function simplifyOrderBy(
  orderBy: OrderBy | OrderBy[] | undefined
): OrderBy[] | undefined {
  if (!orderBy || orderBy.length === 0) return;
  if (Array.isArray(orderBy) && Array.isArray(orderBy[0]))
    return orderBy as OrderBy[];

  return [orderBy] as OrderBy[];
}

function buildFindOptions(
  table: AnyTable,
  { select = true, where, orderBy, join, ...options }: FindManyOptions
): SimplifyFindOptions<FindManyOptions> | false {
  let conditions = where ? buildCondition(where) : undefined;
  if (conditions === true) conditions = undefined;
  if (conditions === false) return false;

  return {
    select,
    where: conditions,
    orderBy: simplifyOrderBy(orderBy),
    join: join ? buildJoin(table, join) : undefined,
    ...options,
  };
}

function buildJoin<T extends AnyTable>(
  table: AnyTable,
  fn: (builder: JoinBuilder<T, {}>) => JoinBuilder<T, unknown>
): CompiledJoin[] {
  const compiled: CompiledJoin[] = [];
  const builder: Record<string, unknown> = {};

  for (const name in table.relations) {
    const relation = table.relations[name]!;

    builder[name] = (options: FindFirstOptions | FindManyOptions = {}) => {
      compiled.push({
        relation,
        options: buildFindOptions(relation.table, options),
      });

      delete builder[name];
      return builder;
    };
  }

  fn(builder as JoinBuilder<T, {}>);
  return compiled;
}

export type SimplifyFindOptions<O> = Omit<
  O,
  "where" | "orderBy" | "select" | "join"
> & {
  select: AnySelectClause;
  where?: Condition | undefined;
  orderBy?: OrderBy[];
  join?: CompiledJoin[];
};

export interface ORMAdapter {
  tables: Record<string, AbstractTable>;
  // TODO: may be better to use bigint here
  count: (table: AbstractTable, v: SimplifiedCountOptions) => Promise<number>;

  findFirst: {
    (
      table: AbstractTable,
      v: SimplifyFindOptions<FindFirstOptions>
    ): Promise<Record<string, unknown> | null>;
  };

  findMany: {
    (
      table: AbstractTable,
      v: SimplifyFindOptions<FindManyOptions>
    ): Promise<Record<string, unknown>[]>;
  };

  updateMany: {
    (
      table: AbstractTable,
      v: {
        where?: Condition;
        set: Record<string, unknown>;
      }
    ): Promise<void>;
  };

  upsert: (
    table: AbstractTable,
    v: {
      where: Condition | undefined;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }
  ) => Promise<void>;

  create: {
    (
      table: AbstractTable,
      values: Record<string, unknown>
    ): Promise<Record<string, unknown>>;
  };

  createMany: {
    (
      table: AbstractTable,
      values: Record<string, unknown>[]
    ): Promise<
      {
        _id: unknown;
      }[]
    >;
  };

  deleteMany: {
    (
      table: AbstractTable,
      v: {
        where?: Condition;
      }
    ): Promise<void>;
  };

  mapTable?: (name: string, table: AnyTable) => AbstractTable;

  /**
   * Override this to support native transaction, otherwise use soft transaction.
   */
  transaction?: <T>(
    run: (transactionInstance: AbstractQuery<AnySchema>) => Promise<T>
  ) => Promise<T>;
}

export function createTables(
  schema: AnySchema,
  mapTable: (name: string, table: AnyTable) => AbstractTable = (
    name: string,
    table: AnyTable
  ) => {
    const mapped = {
      _: new AbstractTableInfo(name, table),
    } as AbstractTable;

    for (const k in table.columns) {
      mapped[k] = new AbstractColumn(table.columns[k]!);
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

enum ActionType {
  Insert,
  Update,
  Delete,
  Sub,
}

type Action =
  | {
      type: ActionType.Delete;
      id: unknown;
      table: AbstractTable;
      values: Record<string, unknown>;
    }
  | {
      type: ActionType.Insert;
      table: AbstractTable;
      id: unknown;
    }
  | {
      type: ActionType.Update;
      id: unknown;
      table: AbstractTable;
      updatedFields: string[];
      beforeUpdate: Record<string, unknown>;
    }
  | {
      type: ActionType.Sub;
      ctx: TransactionAbstractQuery<AnySchema>;
    };

export function toORM<S extends AnySchema>(
  adapter: ORMAdapter
): AbstractQuery<S> {
  return {
    async count(table, { where } = {}) {
      let conditions = where?.(cb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return 0;

      return await adapter.count(table, {
        where: conditions,
      });
    },
    async upsert(table, { where, ...options }) {
      let conditions = where?.(cb);
      if (conditions === false) return;

      await adapter.upsert(table, {
        where: conditions === true ? undefined : conditions,
        ...options,
      });
    },
    async create(table, values) {
      return await adapter.create(table, values);
    },
    async createMany(table: AbstractTable, values) {
      return await adapter.createMany(table, values);
    },
    async deleteMany(table: AbstractTable, { where }) {
      let conditions = where?.(cb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      await adapter.deleteMany(table, { where: conditions });
    },
    async findMany(table, options) {
      const compiledOptions = buildFindOptions(
        table._.raw,
        options as FindManyOptions
      );
      if (compiledOptions === false) return [];

      return await adapter.findMany(table, compiledOptions);
    },
    async findFirst(table, options) {
      const compiledOptions = buildFindOptions(
        table._.raw,
        options as FindFirstOptions
      );
      if (compiledOptions === false) return null;

      return await adapter.findFirst(table, compiledOptions);
    },
    async updateMany(table: AbstractTable, { set, where }) {
      let conditions = where?.(cb);
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      return adapter.updateMany(table, { set, where: conditions });
    },
    async transaction(run) {
      if (adapter.transaction) {
        return adapter.transaction((ctx) =>
          run(ctx as unknown as TransactionAbstractQuery<S>)
        );
      }

      const ctx = createTransaction(this);
      try {
        return await run(ctx);
      } catch (e) {
        await ctx.rollback?.();
        throw e;
      }
    },
    tables: adapter.tables,
  } as AbstractQuery<S>;
}

export function createSoftForeignKey(
  schema: AnySchema,
  orm: Omit<ORMAdapter, "upsert">
): ORMAdapter {
  // table name -> foreign key referencing it
  const childForeignKeys = new Map<string, ForeignKey[]>();

  for (const table of Object.values(schema.tables)) {
    for (const key of table.foreignKeys) {
      const list = childForeignKeys.get(key.referencedTable) ?? [];
      list.push(key);
      childForeignKeys.set(key.referencedTable, list);
    }
  }

  async function checkForeignKey(
    key: ForeignKey,
    values: Record<string, unknown>[]
  ) {
    const refTable = orm.tables[key.referencedTable]!;
    const ifMatchEntry: Condition = {
      type: ConditionType.Or,
      items: [],
    };

    for (const entry of values) {
      const ifMatchColumn: Condition[] = [];
      let containsNull = false;

      for (let i = 0; i < key.columns.length; i++) {
        const col = key.columns[i]!;
        const referencedCol = key.referencedColumns[i]!;
        const value = entry[col];

        // ignore NULL values
        if (value === null) {
          containsNull = true;
          break;
        }

        ifMatchColumn.push({
          type: ConditionType.Compare,
          a: refTable[referencedCol]!,
          operator: "=",
          b: value,
        });
      }

      if (!containsNull)
        ifMatchEntry.items.push({
          type: ConditionType.And,
          items: ifMatchColumn,
        });
    }

    if (ifMatchEntry.items.length === 0) return;

    const matchCount = await orm.count(refTable, {
      where: ifMatchEntry,
    });

    if (matchCount !== ifMatchEntry.items.length) errorForeignKey(key);
  }

  async function foreignKeyOnUpdate(
    key: ForeignKey,
    set: Record<string, unknown>,
    targets: Record<string, unknown>[]
  ) {
    const foreignTable = orm.tables[key.table];
    const isAffected: Condition = {
      type: ConditionType.Or,
      items: [],
    };

    const updated = key.referencedColumns.some((col) => set[col] !== undefined);
    if (!updated) return;

    // build filters to filter affected rows
    for (const target of targets) {
      const condition: Condition = {
        type: ConditionType.And,
        items: [],
      };

      let containsNull = false;

      for (let i = 0; i < key.columns.length; i++) {
        const col = key.columns[i];
        const referencedCol = key.referencedColumns[i];

        if (target[referencedCol] === null) {
          containsNull = true;
          break;
        }

        condition.items.push({
          type: ConditionType.Compare,
          a: foreignTable[col]!,
          operator: "=",
          b: target[referencedCol],
        });
      }

      if (!containsNull) isAffected.items.push(condition);
    }

    if (isAffected.items.length === 0) return;
    if (key.onUpdate === "RESTRICT") {
      const affectedCount = await orm.count(foreignTable, {
        where: isAffected,
      });

      if (affectedCount > 0) errorForeignKey(key);
      return;
    }

    const mappedSet: Record<string, unknown> = {};

    for (let i = 0; i < key.columns.length; i++) {
      const col = key.columns[i];
      const referencedCol = key.referencedColumns[i];

      mappedSet[col] = key.onUpdate === "CASCADE" ? set[referencedCol] : null;
    }

    await orm.updateMany(foreignTable, {
      where: isAffected,
      set: mappedSet as any,
    });
  }

  return {
    ...orm,
    async updateMany(table, { set, where }) {
      const rawTable = table._.raw;
      const foreignKeys = childForeignKeys.get(rawTable.ormName);
      if (!foreignKeys) return orm.updateMany(table, { set, where });

      const idColumnName = rawTable.getIdColumn().ormName;
      const targets = await orm.findMany(table, { select: true, where });

      await Promise.all(
        foreignKeys.map((key) => foreignKeyOnUpdate(key, set, targets))
      );
      await orm.updateMany(table, {
        set,
        where: {
          type: ConditionType.Compare,
          a: table[idColumnName],
          operator: "in",
          b: targets.map((target) => target[idColumnName]),
        },
      });
    },
    // ignore original `upsert` so we can re-use our logic
    async upsert(table, v) {
      const target = await orm.findFirst(table, {
        select: true,
        where: v.where,
      });

      if (target === null) {
        await this.createMany(table, [v.create]);
      } else {
        const idColumn = table._.raw.getIdColumn();

        await this.updateMany(table, {
          set: v.update,
          where: {
            type: ConditionType.Compare,
            a: table[idColumn.ormName],
            operator: "=",
            b: target[idColumn.ormName],
          },
        });
      }
    },
    async create(table, values) {
      const rawTable = table._.raw;
      const foreignKeys = rawTable.foreignKeys;

      await Promise.all(
        foreignKeys.map((key) => checkForeignKey(key, [values]))
      );
      return orm.create(table, values);
    },
    async createMany(table, values) {
      const rawTable = table._.raw;
      const foreignKeys = rawTable.foreignKeys;

      await Promise.all(foreignKeys.map((key) => checkForeignKey(key, values)));
      return orm.createMany(table, values);
    },
    async deleteMany(table, v) {
      const rawTable = table._.raw;
      const foreignKeys = childForeignKeys.get(rawTable.ormName);
      if (!foreignKeys) return orm.deleteMany(table, v);
      const targets = await orm.findMany(table, {
        select: true,
        where: v.where,
      });

      for (const key of foreignKeys) {
        const foreignTable = orm.tables[key.table]!;

        for (let i = 0; i < key.columns.length; i++) {
          const col = key.columns[i]!;
          const referencedColumn = key.referencedColumns[i]!;
          const isAffected: Condition = {
            type: ConditionType.And,
            items: [],
          };

          let containsNull = false;
          for (const target of targets) {
            if (target[referencedColumn] === null) {
              containsNull = true;
              break;
            }

            isAffected.items.push({
              type: ConditionType.Compare,
              a: foreignTable[col]!,
              operator: "=",
              b: target[referencedColumn],
            });
          }

          // ignore NULL values
          if (containsNull) continue;
          if (key.onDelete === "CASCADE") {
            await orm.deleteMany(foreignTable, {
              where: isAffected,
            });
          } else if (key.onDelete === "SET NULL") {
            const set: Record<string, unknown> = {};

            for (const col of key.columns) {
              set[col] = null;
            }

            await orm.updateMany(foreignTable, {
              set: set as any,
              where: isAffected,
            });
          } else {
            const affectedCount = await orm.count(foreignTable, {
              where: isAffected,
            });

            if (affectedCount > 0) errorForeignKey(key);
          }
        }

        return orm.deleteMany(table, v);
      }
    },
  };
}

function errorForeignKey(key: ForeignKey): never {
  throw new Error(`foreign constraint failed ${key.name}`);
}

/**
 * Soft transaction support, doesn't support OCC.
 *
 * It works by reverting your operations when rollback, and during the process concurrent requests may conflict, hence it can be dangerous.
 *
 */
function createTransaction<S extends AnySchema>(
  orm: AbstractQuery<S>
): TransactionAbstractQuery<S> {
  const stack: Action[] = [];

  return {
    count: orm.count,
    findFirst: orm.findFirst,
    findMany: orm.findMany,
    async rollback() {
      while (stack.length > 0) {
        const entry = stack.pop()!;
        if (entry.type === ActionType.Sub) {
          await entry.ctx.rollback?.();
          continue;
        }

        const table = entry.table;
        const idField = table._.raw.getIdColumn().ormName;

        switch (entry.type) {
          case ActionType.Insert:
            await orm.deleteMany(table, {
              where: (b) => b(table[idField]!, "in", entry.id),
            });
            break;
          case ActionType.Update: {
            const set: Record<string, unknown> = {};
            for (const key of entry.updatedFields) {
              set[key] = entry.beforeUpdate[key];
            }
            await orm.updateMany(table, {
              where: (b) => b(table[idField]!, "=", entry.id),
              set,
            });
            break;
          }
          case ActionType.Delete:
            await orm.createMany(table, [entry.values]);
            break;
        }
      }
    },
    async create(table, values) {
      const result = await orm.create(table, values);
      const idField = table._.raw.getIdColumn().ormName;

      stack.push({ type: ActionType.Insert, id: result[idField], table });

      return result;
    },
    async createMany(table, values) {
      const result = await orm.createMany(table, values);

      for (const value of result) {
        stack.push({
          type: ActionType.Insert,
          table,
          id: value._id,
        });
      }

      return result;
    },
    async deleteMany(table, v) {
      const targets = await orm.findMany(table, {
        where: v.where,
      });

      const idField = table._.raw.getIdColumn().ormName;

      await orm.deleteMany(table, {
        where: (b) =>
          b(
            table[idField]!,
            "in",
            targets.map((target) => target[idField])
          ),
      });

      for (const target of targets) {
        stack.push({
          type: ActionType.Delete,
          id: target[idField],
          values: target,
          table,
        });
      }
    },
    async updateMany(table, v) {
      const idField = table._.raw.getIdColumn().ormName;
      const targets = await orm.findMany(table, {
        where: v.where,
      });

      await orm.updateMany(table, {
        set: v.set,
        where: (b) =>
          b(
            table[idField]!,
            "in",
            targets.map((target) => target[idField])
          ),
      });

      const updatedFields = Object.keys(v.set);
      for (const target of targets) {
        stack.push({
          type: ActionType.Update,
          id: target[idField],
          beforeUpdate: target,
          table,
          updatedFields,
        });
      }
    },
    async upsert(table, v) {
      const target = await orm.findFirst(table, {
        where: v.where,
      });

      if (!target) {
        await this.createMany(table, [v.create]);
      } else {
        const idField = table._.raw.getIdColumn().ormName;

        await this.updateMany(table, {
          where: (b) => b(table[idField]!, "=", target[idField]),
          set: v.update,
        });
      }
    },
    transaction(run) {
      return orm.transaction(async (ctx) => {
        const result = await run(ctx);
        stack.push({
          type: ActionType.Sub,
          ctx,
        });

        return result;
      });
    },
    tables: orm.tables,
  };
}
