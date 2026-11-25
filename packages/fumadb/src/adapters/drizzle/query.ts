import * as Drizzle from "drizzle-orm";
import type { AbstractQuery, BatchResult, FindManyOptions } from "../../query";
import { aggregateAliases, aggregatesAsDecimal, fromAliasedRow } from "../../query/aggregate";
import { type Condition, ConditionType } from "../../query/condition-builder";
import { type ORMAdapter, type SimplifyFindOptions, toORM } from "../../query/orm";
import { Increment } from "../../query/increment";
import { createSoftForeignKey } from "../../query/polyfills/foreign-key";
import { type AnyColumn, type AnySchema, type AnyTable, Column } from "../../schema";
import { escapeLike } from "../../shared/like";
import type { SQLProvider } from "../../shared/providers";
import { type ColumnType, type DrizzleMajor, parseDrizzle, type TableType } from "./shared";

/**
 * the right-hand side of `LIKE`, with the escape character of `escapeLike()`
 */
function likePattern(pattern: string) {
  return Drizzle.sql`${pattern} escape '!'`;
}

const affectedRowsKeys = [
  // node-postgres, neon, vercel-postgres
  "rowCount",
  // libsql, planetscale, tidb, op-sqlite, node-mssql (one entry per statement)
  "rowsAffected",
  // mysql2, pglite
  "affectedRows",
  // better-sqlite3, node:sqlite, bun:sqlite, expo-sqlite
  "changes",
  // postgres.js, Bun SQL
  "count",
  // AWS Data API
  "numberOfRecordsUpdated",
];

/**
 * Read the number of rows matched by an `update`/`delete` from the result of the Drizzle driver, its shape differs between drivers.
 */
function toBatchResult(result: unknown): BatchResult {
  // mysql2 resolves to `[ResultSetHeader, FieldPacket[]]`, postgres.js and Bun SQL to an array with `count`
  if (Array.isArray(result) && !("count" in result)) result = result[0];

  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>;

    for (const key of affectedRowsKeys) {
      const value = record[key];

      if (typeof value === "number" || typeof value === "bigint") return { count: Number(value) };
      if (Array.isArray(value)) return { count: value.reduce((sum, n) => sum + Number(n), 0) };
    }

    // Cloudflare D1
    const meta = record.meta as Record<string, unknown> | undefined;
    if (typeof meta?.changes === "number") return { count: meta.changes };
  }

  // the write succeeded, only fail when the count is read
  return {
    get count(): number {
      throw new Error(
        "[FumaDB] the Drizzle driver doesn't report the number of affected rows, `count` is unavailable.",
      );
    },
  };
}

function buildWhere(
  toDrizzle: (col: AnyColumn) => ColumnType,
  condition: Condition,
): Drizzle.SQL | undefined {
  if (condition.type === ConditionType.Compare) {
    const left = toDrizzle(condition.a);
    const op = condition.operator;
    let right = condition.b;
    if (right instanceof Column) right = toDrizzle(right);
    let inverse = false;

    switch (op) {
      case "=":
        return Drizzle.eq(left, right);
      case "!=":
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
        return right === null ? Drizzle.isNotNull(left) : Drizzle.ne(left, right);
      case "not contains":
        inverse = true;
      case "contains":
        right =
          typeof right === "string"
            ? likePattern(`%${escapeLike(right)}%`)
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
            ? likePattern(`%${escapeLike(right)}`)
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
            ? likePattern(`${escapeLike(right)}%`)
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
    return Drizzle.and(...condition.items.map((item) => buildWhere(toDrizzle, item)));

  if (condition.type === ConditionType.Not) {
    const result = buildWhere(toDrizzle, condition.item);
    if (!result) return;

    return Drizzle.not(result);
  }

  return Drizzle.or(...condition.items.map((item) => buildWhere(toDrizzle, item)));
}

type RelationsFilter = Record<string, unknown>;

function buildRelationsWhere(condition: Condition): RelationsFilter | undefined {
  if (condition.type === ConditionType.Compare) {
    const field = condition.a.names.drizzle;
    const op = condition.operator;
    const right = condition.b;

    if (right instanceof Column) {
      const rightField = right.names.drizzle;
      return {
        RAW: (table: Record<string, ColumnType>, { eq, ne, gt, gte, lt, lte }: any) => {
          const leftCol = table[field];
          const rightCol = table[rightField];
          switch (op) {
            case "=":
              return eq(leftCol, rightCol);
            case "!=":
              return ne(leftCol, rightCol);
            case ">":
              return gt(leftCol, rightCol);
            case ">=":
              return gte(leftCol, rightCol);
            case "<":
              return lt(leftCol, rightCol);
            case "<=":
              return lte(leftCol, rightCol);
            default:
              throw new Error(`Unsupported column comparison operator: ${op}`);
          }
        },
      };
    }

    switch (op) {
      // always use the explicit operator form: the `{ [field]: value }` shorthand breaks on
      // object values (Date, Uint8Array) and null, which Drizzle treats as operator maps.
      case "=":
        return right === null ? { [field]: { isNull: true } } : { [field]: { eq: right } };
      case "!=":
        return right === null ? { [field]: { isNotNull: true } } : { [field]: { ne: right } };
      case ">":
        return { [field]: { gt: right } };
      case ">=":
        return { [field]: { gte: right } };
      case "<":
        return { [field]: { lt: right } };
      case "<=":
        return { [field]: { lte: right } };
      case "in":
        return { [field]: { in: right } };
      case "not in":
        return { [field]: { notIn: right } };
      case "is":
        return right === null ? { [field]: { isNull: true } } : { [field]: { eq: right } };
      case "is not":
        return right === null ? { [field]: { isNotNull: true } } : { [field]: { ne: right } };
      case "contains":
        return typeof right === "string"
          ? { [field]: { like: likePattern(`%${escapeLike(right)}%`) } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.like(table[field], Drizzle.sql`concat('%', ${right}, '%')`),
            };
      case "not contains":
        return typeof right === "string"
          ? { [field]: { notLike: likePattern(`%${escapeLike(right)}%`) } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.notLike(table[field], Drizzle.sql`concat('%', ${right}, '%')`),
            };
      case "starts with":
        return typeof right === "string"
          ? { [field]: { like: likePattern(`${escapeLike(right)}%`) } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.like(table[field], Drizzle.sql`concat(${right}, '%')`),
            };
      case "not starts with":
        return typeof right === "string"
          ? { [field]: { notLike: likePattern(`${escapeLike(right)}%`) } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.notLike(table[field], Drizzle.sql`concat(${right}, '%')`),
            };
      case "ends with":
        return typeof right === "string"
          ? { [field]: { like: likePattern(`%${escapeLike(right)}`) } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.like(table[field], Drizzle.sql`concat('%', ${right})`),
            };
      case "not ends with":
        return typeof right === "string"
          ? { [field]: { notLike: likePattern(`%${escapeLike(right)}`) } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.notLike(table[field], Drizzle.sql`concat('%', ${right})`),
            };
      default:
        throw new Error(`Unsupported operator: ${op}`);
    }
  }

  if (condition.type === ConditionType.And) {
    const items = condition.items
      .map((item) => buildRelationsWhere(item))
      .filter((item): item is RelationsFilter => item != null);
    if (items.length === 0) return;
    if (items.length === 1) return items[0];
    return { AND: items };
  }

  if (condition.type === ConditionType.Or) {
    const items = condition.items
      .map((item) => buildRelationsWhere(item))
      .filter((item): item is RelationsFilter => item != null);
    if (items.length === 0) return;
    if (items.length === 1) return items[0];
    return { OR: items };
  }

  if (condition.type === ConditionType.Not) {
    const item = buildRelationsWhere(condition.item);
    if (!item) return;
    return { NOT: item };
  }
}

/**
 * Map update values, an `increment()` becomes `column + step`.
 */
function mapValues(
  values: Record<string, unknown>,
  table: AnyTable,
  drizzleTable: Record<string, ColumnType>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const column of Object.values(table.columns)) {
    const value = values[column.ormName];

    if (value instanceof Increment) {
      const col = drizzleTable[column.names.drizzle];
      // encode the step like a value of the column (e.g. bigint)
      out[column.names.drizzle] = Drizzle.sql`${col} + ${Drizzle.param(value.step, col)}`;
    } else {
      out[column.names.drizzle] = value;
    }
  }

  return out;
}

/**
 * Like `mapValues`, but also generate default values on runtime (e.g. ids).
 */
function mapInsertValues(values: Record<string, unknown>, table: AnyTable) {
  const out: Record<string, unknown> = {};

  for (const column of Object.values(table.columns)) {
    const value = values[column.ormName];
    out[column.names.drizzle] = value === undefined ? column.generateDefaultValue() : value;
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
        out[k] = (value as Record<string, unknown>[]).map((v) => mapQueryResult(relation.table, v));
        continue;
      }

      out[k] = value ? mapQueryResult(relation.table, value as any) : null;
      continue;
    }

    const col = table.getColumnByName(k, "drizzle");
    if (!col) continue;
    out[col.ormName] = decodeValue(value, col);
  }

  return out;
}

function decodeValue(value: unknown, col: AnyColumn): unknown {
  // drivers return decimals as string to keep their precision
  if (col.type === "decimal" && typeof value === "string") return Number(value);
  return value;
}

// TODO: Support binary data in relation queries, because Drizzle doesn't support it: https://github.com/drizzle-team/drizzle-orm/issues/3497
/**
 * Require drizzle query mode (`schema` on 0.x, `relations` on 1.x).
 */
export function fromDrizzle(
  schema: AnySchema,
  _db: unknown,
  provider: SQLProvider,
  isTransaction = false,
): AbstractQuery<AnySchema> {
  const [db, drizzleTables, major] = parseDrizzle(_db);
  // dialects still on RQB v1 in drizzle-orm 1.x (e.g. MSSQL) expose builders on `_query`
  const queryBuilders = db.query ?? db._query!;

  function toDrizzle(v: AnyTable): TableType {
    const out = drizzleTables[v.names.drizzle];
    if (out) return out;

    throw new Error(
      `[FumaDB Drizzle] Unknown table name ${v.names.drizzle}, is it included in your Drizzle schema?`,
    );
  }

  function toDrizzleColumn(v: AnyColumn): ColumnType {
    const table = toDrizzle(v.table!);
    const out = table[v.names.drizzle];
    if (out) return out;

    throw new Error(
      `[FumaDB Drizzle] Unknown column name ${v.names.drizzle} in ${v.table.names.drizzle}.`,
    );
  }

  function buildQueryConfig(
    table: AnyTable,
    options: SimplifyFindOptions<FindManyOptions>,
    rqbMajor: DrizzleMajor,
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

    const out: Record<string, unknown> = {
      columns,
      limit: options.limit,
      offset: options.offset,
    };

    if (rqbMajor === 0) {
      out.where = options.where ? buildWhere(toDrizzleColumn, options.where) : undefined;
      out.orderBy = options.orderBy?.map(([item, mode]) =>
        mode === "asc" ? Drizzle.asc(toDrizzleColumn(item)) : Drizzle.desc(toDrizzleColumn(item)),
      );
    } else {
      // drizzle-orm 1.x throws on an `undefined` filter, only set it when given
      if (options.where) out.where = buildRelationsWhere(options.where);
      out.orderBy = options.orderBy
        ? Object.fromEntries(
            options.orderBy.map(([item, mode]) => [item.names.drizzle, mode] as const),
          )
        : undefined;
    }

    if (options.join) {
      const withRelations: Record<string, unknown> = {};

      for (const join of options.join) {
        if (join.options === false) continue;

        withRelations[join.relation.name] = buildQueryConfig(
          join.relation.table,
          join.options,
          rqbMajor,
        );
      }

      out.with = withRelations;
    }

    return out;
  }

  let adapter: ORMAdapter = {
    tables: schema.tables,
    async count(table, v) {
      const drizzleTable = toDrizzle(table);
      const where = v.where ? buildWhere(toDrizzleColumn, v.where) : undefined;

      // MSSQL doesn't implement `$count`
      if (typeof db.$count !== "function") {
        let query = db.select({ count: Drizzle.count() }).from(drizzleTable);
        if (where) query = query.where(where);

        return Number((await query)[0].count);
      }

      return await db.$count(drizzleTable, where);
    },
    async aggregate(table, v) {
      const drizzleTable = toDrizzle(table);
      const fields: Record<string, unknown> = { [aggregateAliases.count]: Drizzle.count() };
      const asDecimal = (col: AnyColumn) => {
        const ref = toDrizzleColumn(col);
        return aggregatesAsDecimal(col) ? Drizzle.sql`${ref} * 1.0` : ref;
      };

      v.groupBy.forEach((col, i) => (fields[aggregateAliases.groupBy(i)] = toDrizzleColumn(col)));
      v.sum.forEach(
        (col, i) => (fields[aggregateAliases.sum(i)] = Drizzle.sql`sum(${asDecimal(col)})`),
      );
      v.avg.forEach(
        (col, i) =>
          (fields[aggregateAliases.avg(i)] = Drizzle.sql`avg(${toDrizzleColumn(col)} * 1.0)`),
      );
      // decoded like the column
      v.min.forEach(
        (col, i) => (fields[aggregateAliases.min(i)] = Drizzle.min(toDrizzleColumn(col))),
      );
      v.max.forEach(
        (col, i) => (fields[aggregateAliases.max(i)] = Drizzle.max(toDrizzleColumn(col))),
      );

      let query = db.select(fields).from(drizzleTable);
      if (v.where) query = query.where(buildWhere(toDrizzleColumn, v.where));
      if (v.groupBy.length > 0) query = query.groupBy(...v.groupBy.map(toDrizzleColumn));

      const rows: Record<string, unknown>[] = await query;
      return rows.map((row) => fromAliasedRow(row, v, decodeValue));
    },
    async findFirst(table, v) {
      const results = await this.findMany(table, {
        ...v,
        limit: 1,
      });

      return results[0] ?? null;
    },

    async upsert(table, v) {
      const idField = table.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table);
      // MSSQL has no `limit`, it uses `top` (before `from`) instead
      let query =
        provider === "mssql"
          ? db.select({ id: drizzleTable[idField] }).top(1).from(drizzleTable)
          : db.select({ id: drizzleTable[idField] }).from(drizzleTable).limit(1);

      if (v.where) {
        query = query.where(buildWhere(toDrizzleColumn, v.where)) as any;
      }

      const targetIds = await query.execute();

      if (targetIds.length === 0) {
        if (v.returning) return await this.create(table, v.create);

        await this.createMany(table, [v.create]);
        return;
      }

      const isTarget = Drizzle.eq(drizzleTable[idField], targetIds[0].id);
      const update = db
        .update(drizzleTable)
        .set(mapValues(v.update, table, drizzleTable))
        .where(isTarget);

      if (!v.returning) {
        await update;
        return;
      }

      const returning: Record<string, ColumnType> = {};
      for (const column of Object.values(table.columns)) {
        returning[column.ormName] = drizzleTable[column.names.drizzle];
      }

      if (provider === "sqlite" || provider === "postgresql") {
        return (await update.returning(returning))[0];
      }

      await update;
      const results =
        provider === "mssql"
          ? await db.select(returning).top(1).from(drizzleTable).where(isTarget)
          : await db.select(returning).from(drizzleTable).where(isTarget).limit(1);

      return results[0];
    },
    async findMany(table, v) {
      return (
        await queryBuilders[table.names.drizzle].findMany(buildQueryConfig(table, v, major))
      ).map((row) => mapQueryResult(table, row));
    },

    async updateMany(table, v) {
      const drizzleTable = toDrizzle(table);

      let query = db.update(drizzleTable).set(mapValues(v.set, table, drizzleTable));

      if (v.where) {
        query = query.where(buildWhere(toDrizzleColumn, v.where)) as any;
      }

      return toBatchResult(await query);
    },

    async create(table, values) {
      const idField = table.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table);
      values = mapInsertValues(values, table);

      const returning: Record<string, ColumnType> = {};
      for (const column of Object.values(table.columns)) {
        returning[column.ormName] = drizzleTable[column.names.drizzle];
      }

      if (provider === "sqlite" || provider === "postgresql") {
        const result = await db.insert(drizzleTable).values(values).returning(returning);
        return result[0];
      }

      if (provider === "mssql") {
        const result = await db.insert(drizzleTable).output(returning).values(values);
        return result[0];
      }

      await db.insert(drizzleTable).values(values);
      return (
        await db
          .select(returning)
          .from(drizzleTable)
          .where(Drizzle.eq(drizzleTable[idField], values[idField]))
          .limit(1)
      )[0];
    },

    async createMany(table, values) {
      const idField = table.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table);
      values = values.map((v) => mapInsertValues(v, table));

      if (provider === "sqlite" || provider === "postgresql") {
        return await db.insert(drizzleTable).values(values).returning({
          _id: drizzleTable[idField],
        });
      }

      if (provider === "mssql") {
        return await db.insert(drizzleTable).output({ _id: drizzleTable[idField] }).values(values);
      }

      await db.insert(drizzleTable).values(values);
      return values.map((value) => ({ _id: value[idField] }));
    },

    async deleteMany(table, v) {
      const drizzleTable = toDrizzle(table);
      let query = db.delete(drizzleTable);

      if (v.where) {
        query = query.where(buildWhere(toDrizzleColumn, v.where)) as any;
      }

      return toBatchResult(await query);
    },
    transaction(run) {
      // join the current transaction
      if (isTransaction) return run(result);

      return db.transaction((tx) => run(fromDrizzle(schema, tx, provider, true)));
    },
  };

  // like the Kysely engine, MSSQL uses soft foreign keys (`relationMode: "fumadb"`):
  // real ones cannot reference the filtered unique indexes generated for it.
  if (provider === "mssql")
    adapter = createSoftForeignKey(schema, {
      ...adapter,
      generateInsertValuesDefault(table, values) {
        const result: Record<string, unknown> = {};

        for (const k in table.columns) {
          const col = table.columns[k];

          if (values[k] === undefined) {
            result[k] = col.generateDefaultValue();
          } else {
            result[k] = values[k];
          }
        }

        return result;
      },
    });

  const result = toORM(adapter);
  return result;
}
