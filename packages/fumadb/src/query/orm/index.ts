import type { AnyColumn, AnyRelation, AnySchema, AnyTable } from "../../schema";
import type {
  AbstractQuery,
  AnySelectClause,
  FindFirstOptions,
  FindManyOptions,
  JoinBuilder,
  OrderBy,
} from "..";
import { buildCondition, type Condition } from "../condition-builder";

export interface CompiledJoin {
  relation: AnyRelation;
  options: SimplifyFindOptions<FindManyOptions> | false;
}

export interface SimplifiedCountOptions {
  where?: Condition | undefined;
}

function isOrderByArray(v: OrderBy | OrderBy[]): v is OrderBy[] {
  return Array.isArray(v) && Array.isArray(v[0]);
}

function simplifyOrderBy(
  columns: Record<string, AnyColumn>,
  orderBy: OrderBy | OrderBy[] | undefined,
): OrderBy<AnyColumn>[] | undefined {
  if (!orderBy || orderBy.length === 0) return;

  if (!isOrderByArray(orderBy)) orderBy = [orderBy];
  return orderBy.map(([name, value]) => {
    const col = columns[name];
    if (!col) throw new Error(`[FumaDB] unknown column name ${name}.`);

    return [col, value];
  });
}

function buildFindOptions(
  table: AnyTable,
  { select = true, where, orderBy, join, ...options }: FindManyOptions,
): SimplifyFindOptions<FindManyOptions> | false {
  let conditions = where ? buildCondition(table.columns, where) : undefined;
  if (conditions === true) conditions = undefined;
  if (conditions === false) return false;

  return {
    select,
    where: conditions,
    orderBy: simplifyOrderBy(table.columns, orderBy),
    join: join ? buildJoin(table, join) : undefined,
    ...options,
  };
}

function buildJoin<T extends AnyTable>(
  table: AnyTable,
  fn: (builder: JoinBuilder<T, {}>) => JoinBuilder<T, unknown>,
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

export type SimplifyFindOptions<O> = Omit<O, "where" | "orderBy" | "select" | "join"> & {
  select: AnySelectClause;
  where?: Condition | undefined;
  orderBy?: OrderBy<AnyColumn>[];
  join?: CompiledJoin[];
};

export interface ORMAdapter {
  tables: Record<string, AnyTable>;
  count: (table: AnyTable, v: SimplifiedCountOptions) => Promise<number>;

  findFirst: (
    table: AnyTable,
    v: SimplifyFindOptions<FindFirstOptions>,
  ) => Promise<Record<string, unknown> | null>;

  findMany: (
    table: AnyTable,
    v: SimplifyFindOptions<FindManyOptions>,
  ) => Promise<Record<string, unknown>[]>;

  updateMany: (
    table: AnyTable,
    v: {
      where?: Condition;
      set: Record<string, unknown>;
    },
  ) => Promise<void>;

  /**
   * When `returning` is enabled, it must return the created/updated row with all columns selected.
   *
   * Prefer the database's returning clause (e.g. `RETURNING`/`OUTPUT`) when supported, otherwise run an extra query.
   */
  upsert: (
    table: AnyTable,
    v: {
      where: Condition | undefined;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
      returning?: boolean;
    },
  ) => Promise<Record<string, unknown> | void>;

  create: (table: AnyTable, values: Record<string, unknown>) => Promise<Record<string, unknown>>;

  createMany: (
    table: AnyTable,
    values: Record<string, unknown>[],
  ) => Promise<
    {
      _id: unknown;
    }[]
  >;

  deleteMany: (
    table: AnyTable,
    v: {
      where?: Condition;
    },
  ) => Promise<void>;

  /**
   * Override this to support native transaction, otherwise use soft transaction.
   */
  transaction: <T>(
    run: (transactionInstance: AbstractQuery<AnySchema>) => Promise<T>,
  ) => Promise<T>;
}

export function toORM<S extends AnySchema>(adapter: ORMAdapter): AbstractQuery<S> {
  function toTable(name: unknown) {
    const table = adapter.tables[name as string];
    if (!table) throw new Error(`[FumaDB] Invalid table name ${name}.`);

    return table;
  }

  return {
    internal: adapter,
    async count(name, { where } = {}) {
      const table = toTable(name);
      let conditions = where ? buildCondition(table.columns, where) : undefined;
      if (conditions === true) conditions = undefined;
      if (conditions === false) return 0;

      return await adapter.count(table, {
        where: conditions,
      });
    },
    upsert(name, { where, ...options }) {
      async function run(returning: boolean) {
        const table = toTable(name);
        const conditions = where ? buildCondition(table.columns, where) : undefined;

        // the `where` condition never matches, hence no row to update
        if (conditions === false) {
          if (returning)
            throw new Error(
              "[FumaDB] cannot return the upserted row of `upsert()`, its `where` condition never matches any row.",
            );

          return;
        }

        return await adapter.upsert(table, {
          ...options,
          where: conditions === true ? undefined : conditions,
          returning,
        });
      }

      // the query is lazy, so that `forceReturning()` can be handled by adapters natively
      let executed: Promise<void> | undefined;
      let executedReturning: Promise<Record<string, unknown>> | undefined;

      const execute = () => (executed ??= run(false).then(() => undefined));

      return {
        then: (onfulfilled, onrejected) => execute().then(onfulfilled, onrejected),
        catch: (onrejected) => execute().catch(onrejected),
        finally: (onfinally) => execute().finally(onfinally),
        forceReturning() {
          return (executedReturning ??= run(true).then((result) => {
            if (result === undefined)
              throw new Error("[FumaDB] the database adapter didn't return the upserted row.");

            return result;
          }));
        },
      };
    },
    async create(name, values) {
      const table = toTable(name);
      return await adapter.create(table, values);
    },
    async createMany(name, values) {
      const table = toTable(name);
      return await adapter.createMany(table, values);
    },
    async deleteMany(name, { where }) {
      const table = toTable(name);
      let conditions = where ? buildCondition(table.columns, where) : undefined;
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      await adapter.deleteMany(table, { where: conditions });
    },
    async findMany(name, options = {}) {
      const table = toTable(name);
      const compiledOptions = buildFindOptions(table, options as FindManyOptions);
      if (compiledOptions === false) return [];

      return await adapter.findMany(table, compiledOptions);
    },
    async findFirst(name, options) {
      const table = toTable(name);
      const compiledOptions = buildFindOptions(table, options as FindFirstOptions);
      if (compiledOptions === false) return null;

      return await adapter.findFirst(table, compiledOptions);
    },
    async updateMany(name, { set, where }) {
      const table = toTable(name);
      let conditions = where ? buildCondition(table.columns, where) : undefined;
      if (conditions === true) conditions = undefined;
      if (conditions === false) return;

      return adapter.updateMany(table, { set, where: conditions });
    },
    async transaction(run) {
      return adapter.transaction(run as any);
    },
  } as AbstractQuery<S>;
}
