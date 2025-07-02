import * as Drizzle from "drizzle-orm";
import { createTables, ORMAdapter, SimplifyFindOptions } from "./base";
import {
  AbstractColumn,
  AbstractTable,
  AbstractTableInfo,
  AnySelectClause,
  FindManyOptions,
  OrderBy,
} from "..";
import { AnyColumn, AnyRelation, AnySchema, AnyTable } from "../../schema";
import { SQLProvider } from "../../shared/providers";
import {
  Condition,
  ConditionBuilder,
  ConditionType,
} from "../condition-builder";
import type * as MySQL from "drizzle-orm/mysql-core";

type TableType = MySQL.AnyMySqlTable;
type ColumnType = MySQL.AnyMySqlColumn;

class DrizzleAbstractColumn extends AbstractColumn {
  drizzle: ColumnType;

  constructor(
    name: string,
    table: AbstractTableInfo,
    column: AnyColumn,
    drizzle: ColumnType
  ) {
    super(name, table, column);
    this.drizzle = drizzle;
  }
}

class DrizzleAbstractTable extends AbstractTableInfo {
  drizzle: TableType;

  constructor(name: string, table: AnyTable, drizzle: TableType) {
    super(name, table);
    this.drizzle = drizzle;
  }
}

function buildWhere(condition: Condition): Drizzle.SQL | undefined {
  if (condition.type === ConditionType.Compare) {
    const left = toDrizzleColumn(condition.a);
    const op = condition.operator;
    let right = condition.b;
    if (right instanceof DrizzleAbstractColumn) right = right.drizzle;
    let inverse = false;

    switch (op) {
      case "=":
        return Drizzle.eq(left, right);
      case "!=":
      case "<>":
        return Drizzle.ne(left, right);
      case ">":
        return Drizzle.gt(left, right);
      case ">=":
        return Drizzle.gte(left, right);
      case "<":
        return Drizzle.lt(left, right);
      case "<=":
        return Drizzle.lte(left, right);
      case "in": {
        // @ts-expect-error -- skip type check
        return Drizzle.inArray(left, right);
      }
      case "not in":
        // @ts-expect-error -- skip type check
        return Drizzle.notInArray(left, right);
      case "is":
        return right === null ? Drizzle.isNull(left) : Drizzle.eq(left, right);
      case "is not":
        return right === null
          ? Drizzle.isNotNull(left)
          : Drizzle.ne(left, right);
      case "not contains":
        inverse = true;
      case "contains":
        right =
          typeof right === "string"
            ? `%${right}%`
            : Drizzle.sql`concat('%', ${right}, '%')`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);
      case "not ends with":
        inverse = true;
      case "ends with":
        right =
          typeof right === "string"
            ? `%${right}`
            : Drizzle.sql`concat('%', ${right})`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);
      case "not starts with":
        inverse = true;
      case "starts with":
        right =
          typeof right === "string"
            ? `${right}%`
            : Drizzle.sql`concat(${right}, '%')`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);

      default:
        throw new Error(`Unsupported operator: ${op}`);
    }
  }

  if (condition.type === ConditionType.And)
    return Drizzle.and(...condition.items.map(buildWhere));

  if (condition.type === ConditionType.Not) {
    const result = buildWhere(condition.item);
    if (!result) return;

    return Drizzle.not(result);
  }

  return Drizzle.or(...condition.items.map(buildWhere));
}

function mapSelect(
  select: AnySelectClause
): Record<string, boolean> | undefined {
  if (Array.isArray(select)) {
    const out: Record<string, boolean> = {};

    for (const item of select) {
      out[item] = true;
    }

    return out;
  }
}

/**
 * Require drizzle query mode, make sure to configure it first. (including the `schema` option)
 */
export function fromDrizzle(
  schema: AnySchema,
  _db: unknown,
  provider: SQLProvider
): ORMAdapter {
  // to avoid complex types problems
  const db = _db as MySQL.MySqlDatabase<
    MySQL.MySqlQueryResultHKT,
    MySQL.PreparedQueryHKTBase,
    Record<string, unknown>,
    Drizzle.TablesRelationalConfig
  >;
  const tables = db._.fullSchema as Record<string, TableType>;
  if (!schema || Object.keys(schema).length === 0)
    throw new Error(
      "[fumadb] Drizzle adapter requires query mode, make sure to configure it following their guide: https://orm.drizzle.team/docs/rqb."
    );

  const abstractTables = createTables(schema, (name, table) => {
    const mapped = {
      _: new DrizzleAbstractTable(name, table, tables[name]!),
    } as unknown as AbstractTable;

    for (const k in table.columns) {
      mapped[k] = new DrizzleAbstractColumn(
        k,
        mapped._,
        table.columns[k]!,
        tables[name]!._.columns[k]!
      );
    }

    return mapped;
  });

  return {
    tables: abstractTables,
    async findFirst(table, v) {
      const results = await this.findMany(table, {
        ...v,
        limit: 1,
      });

      if (results.length === 0) return null;
      return results[0]!;
    },

    async findMany(table, v) {
      function buildConfig(options: SimplifyFindOptions<FindManyOptions>) {
        const out: Drizzle.DBQueryConfig<"many" | "one", boolean> = {
          columns: mapSelect(options.select),
          limit: options.limit,
          offset: options.offset,
          where: options.where ? buildWhere(options.where) : undefined,
          orderBy: options.orderBy?.map(([item, mode]) =>
            mode === "asc"
              ? Drizzle.asc(toDrizzleColumn(item))
              : Drizzle.desc(toDrizzleColumn(item))
          ),
        };

        if (options.join) {
          out.with = {};

          for (const join of options.join) {
            if (join.options === false) continue;

            out.with[join.relation.ormName] = buildConfig(join.options);
          }
        }

        return out;
      }

      return db.query[table._.name]!.findMany(buildConfig(v));
    },

    async updateMany(table, v) {
      const drizzleTable = toDrizzle(table._);

      let query = db.update(drizzleTable).set(v.set);

      if (v.where) {
        query = query.where(buildWhere(v.where)) as any;
      }

      await query;
    },

    async create(table, values) {
      const drizzleTable = toDrizzle(table._);

      const query = db.insert(drizzleTable).values(values);

      if (provider === "sqlite" || provider === "postgresql") {
        // @ts-expect-error -- not supported by MySQL
        return (await query.returning())[0];
      }

      const obj = (await query.$returningId())[0] as Record<string, unknown>;
      const conditons = [];
      for (const k in obj) {
        const col = toDrizzleColumn(table[k]!);

        conditons.push(Drizzle.eq(col, obj[k]));
      }

      return db
        .select()
        .from(drizzleTable)
        .where(Drizzle.and(...conditons))
        .limit(1);
    },

    async createMany(table, values) {
      const drizzleTable = toDrizzle(table._);

      await db.insert(drizzleTable).values(values);
    },

    async deleteMany(table, v) {
      const drizzleTable = toDrizzle(table._);
      let query = db.delete(drizzleTable);

      if (v.where) {
        query = query.where(buildWhere(v.where)) as any;
      }

      await query;
    },
  };
}

function toDrizzle(v: AbstractTableInfo): TableType {
  if (v instanceof DrizzleAbstractTable) return v.drizzle;

  throw new Error("your table object must be created by the drizzle adapter");
}

function toDrizzleColumn(v: AbstractColumn): ColumnType {
  if (v instanceof DrizzleAbstractColumn) return v.drizzle;

  throw new Error("your column object must be created by the drizzle adapter");
}
