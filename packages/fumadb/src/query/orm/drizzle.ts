import * as Drizzle from "drizzle-orm";
import { createTables, SimplifyFindOptions, toORM } from "./base";
import {
  AbstractColumn,
  AbstractQuery,
  AbstractTable,
  AbstractTableInfo,
  FindManyOptions,
} from "..";
import { AnyColumn, AnySchema, AnyTable } from "../../schema";
import { SQLProvider } from "../../shared/providers";
import { Condition, ConditionType } from "../condition-builder";
import type * as MySQL from "drizzle-orm/mysql-core";
import type * as PostgreSQL from "drizzle-orm/pg-core";

type TableType = MySQL.MySqlTableWithColumns<MySQL.TableConfig>;
type ColumnType = MySQL.AnyMySqlColumn;
type DBType = MySQL.MySqlDatabase<
  MySQL.MySqlQueryResultHKT,
  MySQL.PreparedQueryHKTBase,
  Record<string, unknown>,
  Drizzle.TablesRelationalConfig
>;

type P_TableType = PostgreSQL.PgTableWithColumns<PostgreSQL.TableConfig>;
type P_ColumnType = PostgreSQL.AnyPgColumn;
type P_DBType = PostgreSQL.PgDatabase<
  PostgreSQL.PgQueryResultHKT,
  Record<string, unknown>,
  Drizzle.TablesRelationalConfig
>;

class DrizzleAbstractColumn extends AbstractColumn {
  drizzle: ColumnType;

  constructor(column: AnyColumn, drizzle: ColumnType) {
    super(column);
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

function mapValues(
  values: Record<string, unknown>,
  table: AnyTable
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const column of Object.values(table.columns)) {
    out[column.names.drizzle] = values[column.ormName];
  }

  return out;
}

function mapQueryResult(table: AnyTable, result: Record<string, unknown>) {
  const out: Record<string, unknown> = {};

  for (const k in result) {
    const value = result[k];

    if (k in table.relations) {
      const relation = table.relations[k];

      if (relation.type === "many") {
        out[k] = (value as Record<string, unknown>[]).map((v) =>
          mapQueryResult(relation.table, v)
        );
        continue;
      }

      out[k] = value ? mapQueryResult(relation.table, value as any) : null;
      continue;
    }

    const col = table.getColumnByName(k, "drizzle");
    if (!col) continue;
    out[col.ormName] = value;
  }

  return out;
}

// TODO: Support binary data in relation queries, because Drizzle doesn't support it: https://github.com/drizzle-team/drizzle-orm/issues/3497
/**
 * Require drizzle query mode, make sure to configure it first. (including the `schema` option)
 */
export function fromDrizzle(
  schema: AnySchema,
  _db: unknown,
  provider: SQLProvider
): AbstractQuery<AnySchema> {
  const db = _db as DBType;
  const drizzleTables = db._.fullSchema as Record<string, TableType>;
  if (!drizzleTables || Object.keys(drizzleTables).length === 0)
    throw new Error(
      "[fumadb] Drizzle adapter requires query mode, make sure to configure it following their guide: https://orm.drizzle.team/docs/rqb."
    );

  const abstractTables = createTables(schema, (name, table) => {
    const drizzleTable = drizzleTables[table.names.drizzle];
    if (!drizzleTable)
      throw new Error(`Table ${table.names.drizzle} is not found on schema.`);

    const mapped = {
      _: new DrizzleAbstractTable(table.ormName, table, drizzleTable),
    } as unknown as AbstractTable;

    for (const col of Object.values(table.columns)) {
      const drizzleCol = drizzleTable[col.names.drizzle];
      if (!drizzleCol)
        throw new Error(
          `Column ${col.names.drizzle} in ${table.names.drizzle} is not found on schema.`
        );

      mapped[col.ormName] = new DrizzleAbstractColumn(col, drizzleCol);
    }

    return mapped;
  });

  // Drizzle Queries doesn't support renaming fields with `mapWith` because https://github.com/drizzle-team/drizzle-orm/issues/1157
  // we need to map the result on JS instead of relying on Drizzle
  function buildQueryConfig(
    table: AnyTable,
    options: SimplifyFindOptions<FindManyOptions>
  ) {
    const columns: Record<string, boolean> = {};
    const select = options.select;

    if (select === true) {
      for (const col of Object.values(table.columns)) {
        columns[col.names.drizzle] = true;
      }
    } else {
      for (const k of select) {
        columns[table.columns[k].names.drizzle] = true;
      }
    }

    const out: Drizzle.DBQueryConfig<"many" | "one", boolean> = {
      columns,
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

        out.with[join.relation.name] = buildQueryConfig(
          join.relation.table,
          join.options
        );
      }
    }

    return out;
  }

  return toORM({
    tables: abstractTables,
    async count(table, v) {
      return await db.$count(
        toDrizzle(table._),
        v.where ? buildWhere(v.where) : undefined
      );
    },
    async findFirst(table, v) {
      const results = await this.findMany(table, {
        ...v,
        limit: 1,
      });

      return results[0] ?? null;
    },

    async upsert(table, v) {
      const rawTable = table._.raw;
      const idField = rawTable.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table._);
      let query = db
        .select({ id: drizzleTable[idField] })
        .from(drizzleTable)
        .limit(1);

      if (v.where) {
        query = query.where(buildWhere(v.where)) as any;
      }

      const targetIds = await query.execute();

      if (targetIds.length > 0) {
        await db
          .update(drizzleTable)
          .set(mapValues(v.update, rawTable))
          .where(Drizzle.eq(drizzleTable[idField], targetIds[0].id));
      } else {
        await this.createMany(table, [v.create]);
      }
    },
    async findMany({ _: { raw } }, v) {
      return (
        await db.query[raw.names.drizzle].findMany(buildQueryConfig(raw, v))
      ).map((v) => mapQueryResult(raw, v));
    },

    async updateMany(table, v) {
      const drizzleTable = toDrizzle(table._);

      let query = db.update(drizzleTable).set(mapValues(v.set, table._.raw));

      if (v.where) {
        query = query.where(buildWhere(v.where)) as any;
      }

      await query;
    },

    async create(table, values) {
      const rawTable = table._.raw;
      const idField = rawTable.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table._);
      values = mapValues(values, rawTable);

      const returning: Record<string, ColumnType> = {};
      for (const column of Object.values(rawTable.columns)) {
        returning[column.ormName] = drizzleTable[column.names.drizzle];
      }

      if (provider === "sqlite" || provider === "postgresql") {
        const result = await (db as unknown as P_DBType)
          .insert(drizzleTable as unknown as P_TableType)
          .values(values)
          .returning(returning as unknown as Record<string, P_ColumnType>);
        return result[0];
      }

      const obj = (
        await db.insert(drizzleTable).values(values).$returningId()
      )[0] as Record<string, unknown>;

      return (
        await db
          .select(returning)
          .from(drizzleTable)
          .where(Drizzle.eq(drizzleTable[idField], obj[idField]))
          .limit(1)
      )[0];
    },

    async createMany(table, values) {
      const rawTable = table._.raw;
      const idField = rawTable.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table._);
      values = values.map((v) => mapValues(v, rawTable));

      if (provider === "sqlite" || provider === "postgresql") {
        return await (db as unknown as P_DBType)
          .insert(drizzleTable as unknown as P_TableType)
          .values(values)
          .returning({
            _id: (drizzleTable as unknown as P_TableType)[idField],
          });
      }

      const results: Record<string, unknown>[] = await db
        .insert(drizzleTable)
        .values(values)
        .$returningId();
      return results.map((result) => ({ _id: result[idField] }));
    },

    async deleteMany(table, v) {
      const drizzleTable = toDrizzle(table._);
      let query = db.delete(drizzleTable);

      if (v.where) {
        query = query.where(buildWhere(v.where)) as any;
      }

      await query;
    },
    transaction(run) {
      return db.transaction((tx) => run(fromDrizzle(schema, tx, provider)));
    },
  });
}

function toDrizzle(v: AbstractTableInfo): TableType {
  if (v instanceof DrizzleAbstractTable) return v.drizzle;

  throw new Error("your table object must be created by the drizzle adapter");
}

function toDrizzleColumn(v: AbstractColumn): ColumnType {
  if (v instanceof DrizzleAbstractColumn) return v.drizzle;

  throw new Error("your column object must be created by the drizzle adapter");
}
