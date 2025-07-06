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
} from "..";
import {
  buildCondition,
  builder as cb,
  type Condition,
} from "../condition-builder";
import { AnyRelation, AnySchema, AnyTable } from "../../schema";

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
  count: (table: AbstractTable, v: SimplifiedCountOptions) => Promise<number>;

  findFirst: {
    (
      table: AbstractTable,
      v: SimplifyFindOptions<FindFirstOptions>
    ): Promise<Record<string, unknown> | null>;
  };

  findMany: {
    (table: AbstractTable, v: SimplifyFindOptions<FindManyOptions>): Promise<
      Record<string, unknown>[]
    >;
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

  mapTable?: (name: string, table: AnyTable) => AbstractTable;
}

export function getAbstractTableKeys(table: AbstractTable) {
  const out: string[] = [];

  for (const k in table) {
    if (k !== "_") out.push(k);
  }

  return out;
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
      await adapter.createMany(table, values);
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
    tables: adapter.tables,
  } as AbstractQuery<S>;
}
