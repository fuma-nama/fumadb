import * as Drizzle from "drizzle-orm";
import type { AbstractQuery, FindManyOptions } from "../../query";
import { type Condition, ConditionType } from "../../query/condition-builder";
import { type SimplifyFindOptions, toORM } from "../../query/orm";
import { type AnyColumn, type AnySchema, type AnyTable, Column } from "../../schema";
import type { SQLProvider } from "../../shared/providers";
import { type ColumnType, type DrizzleMajor, parseDrizzle, type TableType } from "./shared";

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
        right = typeof right === "string" ? `%${right}%` : Drizzle.sql`concat('%', ${right}, '%')`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);
      case "not ends with":
        inverse = true;
      case "ends with":
        right = typeof right === "string" ? `%${right}` : Drizzle.sql`concat('%', ${right})`;

        return inverse
          ? // @ts-expect-error -- skip type check
            Drizzle.notLike(left, right)
          : // @ts-expect-error -- skip type check
            Drizzle.like(left, right);
      case "not starts with":
        inverse = true;
      case "starts with":
        right = typeof right === "string" ? `${right}%` : Drizzle.sql`concat(${right}, '%')`;

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
      case "=":
        return { [field]: right };
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
        return right === null ? { [field]: { isNull: true } } : { [field]: right };
      case "is not":
        return right === null ? { [field]: { isNotNull: true } } : { [field]: { ne: right } };
      case "contains":
        return typeof right === "string"
          ? { [field]: { like: `%${right}%` } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.like(table[field], Drizzle.sql`concat('%', ${right}, '%')`),
            };
      case "not contains":
        return typeof right === "string"
          ? { [field]: { notLike: `%${right}%` } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.notLike(table[field], Drizzle.sql`concat('%', ${right}, '%')`),
            };
      case "starts with":
        return typeof right === "string"
          ? { [field]: { like: `${right}%` } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.like(table[field], Drizzle.sql`concat(${right}, '%')`),
            };
      case "not starts with":
        return typeof right === "string"
          ? { [field]: { notLike: `${right}%` } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.notLike(table[field], Drizzle.sql`concat(${right}, '%')`),
            };
      case "ends with":
        return typeof right === "string"
          ? { [field]: { like: `%${right}` } }
          : {
              RAW: (table: Record<string, ColumnType>) =>
                Drizzle.like(table[field], Drizzle.sql`concat('%', ${right})`),
            };
      case "not ends with":
        return typeof right === "string"
          ? { [field]: { notLike: `%${right}` } }
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

function mapValues(values: Record<string, unknown>, table: AnyTable): Record<string, unknown> {
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
        out[k] = (value as Record<string, unknown>[]).map((v) => mapQueryResult(relation.table, v));
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
 * Require drizzle query mode (`schema` on 0.x, `relations` on 1.x).
 */
export function fromDrizzle(
  schema: AnySchema,
  _db: unknown,
  provider: SQLProvider,
): AbstractQuery<AnySchema> {
  const [db, drizzleTables, major] = parseDrizzle(_db);

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
      out.where = options.where ? buildRelationsWhere(options.where) : undefined;
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

  return toORM({
    tables: schema.tables,
    async count(table, v) {
      return await db.$count(
        toDrizzle(table),
        v.where ? buildWhere(toDrizzleColumn, v.where) : undefined,
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
      const idField = table.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table);
      let query = db.select({ id: drizzleTable[idField] }).from(drizzleTable).limit(1);

      if (v.where) {
        query = query.where(buildWhere(toDrizzleColumn, v.where)) as any;
      }

      const targetIds = await query.execute();

      if (targetIds.length > 0) {
        await db
          .update(drizzleTable)
          .set(mapValues(v.update, table))
          .where(Drizzle.eq(drizzleTable[idField], targetIds[0].id));
      } else {
        await this.createMany(table, [v.create]);
      }
    },
    async findMany(table, v) {
      return (await db.query[table.names.drizzle].findMany(buildQueryConfig(table, v, major))).map(
        (row) => mapQueryResult(table, row),
      );
    },

    async updateMany(table, v) {
      const drizzleTable = toDrizzle(table);

      let query = db.update(drizzleTable).set(mapValues(v.set, table));

      if (v.where) {
        query = query.where(buildWhere(toDrizzleColumn, v.where)) as any;
      }

      await query;
    },

    async create(table, values) {
      const idField = table.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table);
      values = mapValues(values, table);

      const returning: Record<string, ColumnType> = {};
      for (const column of Object.values(table.columns)) {
        returning[column.ormName] = drizzleTable[column.names.drizzle];
      }

      if (provider === "sqlite" || provider === "postgresql") {
        const result = await db.insert(drizzleTable).values(values).returning(returning);
        return result[0];
      }

      const obj = (await db.insert(drizzleTable).values(values).$returningId())[0] as Record<
        string,
        unknown
      >;

      return (
        await db
          .select(returning)
          .from(drizzleTable)
          .where(Drizzle.eq(drizzleTable[idField], obj[idField]))
          .limit(1)
      )[0];
    },

    async createMany(table, values) {
      const idField = table.getIdColumn().names.drizzle;
      const drizzleTable = toDrizzle(table);
      values = values.map((v) => mapValues(v, table));

      if (provider === "sqlite" || provider === "postgresql") {
        return await db.insert(drizzleTable).values(values).returning({
          _id: drizzleTable[idField],
        });
      }

      const results: Record<string, unknown>[] = await db
        .insert(drizzleTable)
        .values(values)
        .$returningId();
      return results.map((result) => ({ _id: result[idField] }));
    },

    async deleteMany(table, v) {
      const drizzleTable = toDrizzle(table);
      let query = db.delete(drizzleTable);

      if (v.where) {
        query = query.where(buildWhere(toDrizzleColumn, v.where)) as any;
      }

      await query;
    },
    transaction(run) {
      return db.transaction((tx) => run(fromDrizzle(schema, tx, provider)));
    },
  });
}
