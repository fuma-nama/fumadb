import * as Drizzle from "drizzle-orm";
import { createTables, ORMAdapter } from "./base";
import {
  AbstractColumn,
  AbstractTable,
  AbstractTableInfo,
  AnyJoinClause,
  AnySelectClause,
} from "..";
import { AnyColumn, AnyRelation, AnySchema, AnyTable } from "../../schema";
import { SQLProvider } from "../../shared/providers";
import { Condition, ConditionType } from "../condition-builder";

class DrizzleAbstractColumn extends AbstractColumn {
  drizzle: Drizzle.AnyColumn;

  constructor(
    name: string,
    table: AbstractTableInfo,
    column: AnyColumn,
    drizzle: Drizzle.AnyColumn
  ) {
    super(name, table, column);
    this.drizzle = drizzle;
  }
}

class DrizzleAbstractTable extends AbstractTableInfo {
  drizzle: Drizzle.Table;

  constructor(name: string, table: AnyTable, drizzle: Drizzle.Table) {
    super(name, table);
    this.drizzle = drizzle;
  }
}

function buildWhere(condition: Condition): Drizzle.SQLWrapper | undefined {
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

type MappedSelect = {
  [key: string]: Drizzle.AnyColumn | Drizzle.Table | MappedSelect;
};

function mapSelect(
  select: AnySelectClause,
  table: Drizzle.Table
): MappedSelect {
  const out: MappedSelect = {};

  if (Array.isArray(select)) {
    for (const item of select) {
      out[item] = table._.columns[item]!;
    }

    return out;
  } else {
    Object.assign(out, table._.columns);
  }

  return out;
}

export function fromDrizzle(
  schema: AnySchema,
  _db: unknown,
  tables: Record<string, Drizzle.Table>,
  provider: SQLProvider
): ORMAdapter {
  // to avoid complex types problems, let's embrace `any`!
  const db = _db as any;

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
      const drizzleTable = toDrizzle(table._);
      const select = mapSelect(v.select, drizzleTable);

      const joinMany: [string, AnyRelation][] = [];
      const after: ((v: any) => any)[] = [];

      if (v.join) {
        for (const k in v.join) {
          const relation = table._.raw.relations[k]!;
          if (relation.type === "many") {
            for (const [left] of relation.on) {
              select[left] ??= drizzleTable._.columns[left]!;
            }
            joinMany.push([k, relation]);
            continue;
          }

          const target = tables[relation.table.ormName]!;
          // update select
          select[k] = mapSelect(v.join[k]!, target);

          const on = Drizzle.and(
            ...relation.on.map(([left, right]) =>
              Drizzle.eq(
                drizzleTable._.columns[left]!,
                target._.columns[right]!
              )
            )
          );

          if (relation.type === "one?") {
            after.push((query) => query.leftJoin(target, on));
          } else {
            after.push((query) => query.innerJoin(target, on));
          }
        }
      }

      let query = db.select(select).from(drizzleTable);

      if (v.where) query = query.where(buildWhere(v.where));
      if (v.limit !== undefined) query = query.limit(v.limit);
      if (v.offset !== undefined) query = query.offset(v.offset);
      if (v.orderBy) {
        const items = [];
        for (const [item, mode] of v.orderBy) {
          const drizzleCol = toDrizzleColumn(item);

          items.push(
            mode === "asc" ? Drizzle.asc(drizzleCol) : Drizzle.desc(drizzleCol)
          );
        }

        query = query.orderBy(...items);
      }

      for (const item of after) query = item(query);

      const records = await query;
      if (joinMany.length === 0) return records;

      // CTE isn't always supported, we'll use subquery instead
      await Promise.all(
        joinMany.map(async ([name, relation]) => {
          const target = abstractTables[relation.table.ormName]!;
          const conditions: Condition[] = [];

          for (const record of records) {
            const condition: Condition = {
              type: ConditionType.And,
              items: [],
            };

            for (const [left, right] of relation.on) {
              condition.items.push({
                type: ConditionType.Compare,
                a: target[right]!,
                b: record[left],
                operator: "=",
              });
            }

            conditions.push(condition);
          }

          const sub = await this.findMany(target, {
            select: v.join![name]!,
            where: {
              type: ConditionType.Or,
              items: conditions,
            },
          });

          for (const record of records) {
            const joined = sub.filter((subItem) => {
              for (const [left, right] of relation.on) {
                if (record[left] !== subItem[right]) return false;
              }

              return true;
            });

            record[name] = joined;
          }
        })
      );

      return records;
    },

    async updateMany(table, v) {
      const drizzleTable = toDrizzle(table._);

      let query = db.update(drizzleTable).set(v.set);

      if (v.where) {
        query = query.where(buildWhere(v.where));
      }

      await query;
    },

    async create(table, values) {
      const drizzleTable = toDrizzle(table._);

      const query = db.insert(drizzleTable).values(values);

      if (provider === "sqlite" || provider === "postgresql") {
        return (await query.returning())[0];
      }

      const obj = (await query.$returningId())[0];
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
        query = query.where(buildWhere(v.where));
      }

      await query;
    },
  };
}

function toDrizzle(v: AbstractTableInfo): Drizzle.Table {
  if (v instanceof DrizzleAbstractTable) return v.drizzle;

  throw new Error("your table object must be created by the drizzle adapter");
}

function toDrizzleColumn(v: AbstractColumn): Drizzle.AnyColumn {
  if (v instanceof DrizzleAbstractColumn) return v.drizzle;

  throw new Error("your column object must be created by the drizzle adapter");
}
