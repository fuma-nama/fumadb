import {
  BinaryOperator,
  ExpressionBuilder,
  ExpressionWrapper,
  Kysely,
  sql,
} from "kysely";
import { createTables, getAbstractTableKeys, ORMAdapter } from "./base";
import { AbstractColumn, AbstractTable, AnySelectClause } from "..";
import { SqlBool } from "kysely";
import { AnyColumn, AnySchema, AnyTable } from "../../schema";
import { SQLProvider } from "../../shared/providers";
import { createId } from "../../cuid";
import { Condition, ConditionType } from "../condition-builder";

export function buildWhere(
  condition: Condition,
  eb: ExpressionBuilder<any, any>,
  provider: SQLProvider
): ExpressionWrapper<any, any, SqlBool> {
  if (condition.type === ConditionType.Compare) {
    const left = condition.a;
    const op = condition.operator;
    let val = condition.b;

    if (!(val instanceof AbstractColumn)) {
      val = encodeValue(val, left, provider);
    }

    let v: BinaryOperator;
    let rhs;

    switch (op) {
      case "contains":
        v = "like";
      case "not contains":
        v ??= "not like";
        rhs =
          val instanceof AbstractColumn
            ? sql`concat('%', ${eb.ref(val.getSQLName())}, '%')`
            : `%${val}%`;

        break;
      case "starts with":
        v = "like";
      case "not starts with":
        v ??= "not like";
        rhs =
          val instanceof AbstractColumn
            ? sql`concat(${eb.ref(val.getSQLName())}, '%')`
            : `${val}%`;

        break;
      case "ends with":
        v = "like";
      case "not ends with":
        v ??= "not like";
        rhs =
          val instanceof AbstractColumn
            ? sql`concat('%', ${eb.ref(val.getSQLName())})`
            : `%${val}`;
        break;
      default:
        v = op;
        rhs = val instanceof AbstractColumn ? eb.ref(val.getSQLName()) : val;
    }

    return eb(left.getSQLName(), v, rhs);
  }

  // Nested conditions
  if (condition.type === ConditionType.And) {
    return eb.and(condition.items.map((v) => buildWhere(v, eb, provider)));
  }

  if (condition.type === ConditionType.Not) {
    return eb.not(buildWhere(condition.item, eb, provider));
  }

  return eb.or(condition.items.map((v) => buildWhere(v, eb, provider)));
}

function decodeValue(value: unknown, col: AnyColumn, provider: SQLProvider) {
  if (provider !== "sqlite") return value;

  if (col.type === "json" && typeof value === "string") {
    return JSON.parse(value);
  }

  if (
    (col.type === "timestamp" || col.type === "date") &&
    (typeof value === "number" || typeof value === "string")
  ) {
    return new Date(value);
  }

  if (col.type === "bool" && typeof value === "number") return value === 1;

  if (col.type === "bigint" && value instanceof Buffer) {
    return value.readBigInt64BE(0);
  }

  return value;
}

function encodeValue(
  value: unknown,
  column: AbstractColumn,
  provider: SQLProvider
) {
  if (provider !== "sqlite") return value;
  const raw = column.raw;

  if (value === null) return null;

  if (raw.type === "json") {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "boolean") return value ? 1 : 0;

  if (typeof value === "bigint") {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(value);
    return buf;
  }

  return value;
}

function mapSelect(
  select: AnySelectClause,
  table: AbstractTable,
  parent = ""
): string[] {
  const out: string[] = [];
  const keys = Array.isArray(select) ? select : getAbstractTableKeys(table);
  for (const col of keys) {
    const name = parent.length > 0 ? parent + ":" + col : col;

    out.push(`${table[col]!.getSQLName()} as ${name}`);
  }

  return out;
}

function extendSelect(original: AnySelectClause): {
  extend: (key: string) => void;
  compile: () => {
    result: AnySelectClause;
    extendedKeys: string[];
  };
} {
  const select = Array.isArray(original) ? new Set(original) : true;
  const extendedKeys: string[] = [];

  return {
    extend(key) {
      if (select === true || select.has(key)) return;

      select.add(key);
      extendedKeys.push(key);
    },
    compile() {
      return {
        result: select instanceof Set ? Array.from(select) : true,
        extendedKeys,
      };
    },
  };
}

// always use raw SQL names since Kysely is a query builder
export function fromKysely(
  schema: AnySchema,
  kysely: Kysely<any>,
  provider: SQLProvider
): ORMAdapter {
  const abstractTables = createTables(schema);

  /**
   * Transform object keys and encode values (e.g. for SQLite, date -> number)
   */
  function encodeValues(
    values: Record<string, unknown>,
    table: AbstractTable,
    generateDefault: boolean
  ) {
    const result: Record<string, unknown> = {};

    for (const k in values) {
      const col = table[k];
      const value = values[k];

      if (value === undefined || !col) continue;
      result[col.raw.name] = encodeValue(value, col, provider);
    }

    if (generateDefault) {
      for (const k in table) {
        if (k === "_") continue;
        const col = table[k]!;

        if (
          col.isID() &&
          col.raw.default === "auto" &&
          (!(k in result) || result[k] === undefined)
        ) {
          result[k] = createId();
        }
      }
    }

    return result;
  }

  /**
   * Transform object keys and decode values
   */
  function decodeResult(result: Record<string, unknown>, table: AnyTable) {
    const output: Record<string, unknown> = {};

    for (const k in result) {
      const segs = k.split(":", 2);
      const value = result[k];

      if (segs.length === 1) {
        output[k] = decodeValue(value, table.columns[k]!, provider);
      }

      if (segs.length === 2) {
        const [relationName, colName] = segs as [string, string];
        const relation = table.relations[relationName];
        if (relation === undefined) continue;
        const col = relation.table.columns[colName];
        if (col === undefined) continue;

        output[relationName] ??= {};
        const obj = output[relationName] as Record<string, unknown>;
        obj[colName] = decodeValue(value, col, provider);
      }
    }

    return output;
  }

  return {
    tables: abstractTables,
    async create(table, values) {
      const insertValues = encodeValues(values, table, true);
      let query = kysely.insertInto(table._.raw.name).values(insertValues);

      if (provider === "mssql") {
        return decodeResult(
          await query.outputAll("inserted").executeTakeFirstOrThrow(),
          table._.raw
        );
      }

      if (provider === "postgresql" || provider === "sqlite") {
        return decodeResult(
          await query.returningAll().executeTakeFirstOrThrow(),
          table._.raw
        );
      }

      for (const k in table) {
        if (k === "_") continue;
        const col = table[k]!;

        if (col.isID()) {
          const value = insertValues[k];
          if (!value) continue;

          await query.execute();
          return decodeResult(
            await kysely
              .selectFrom(table._.raw.name)
              .selectAll()
              .where(col.getSQLName(), "=", value)
              .limit(1)
              .executeTakeFirstOrThrow(),
            table._.raw
          );
        }
      }

      throw new Error(
        "cannot find value of id column, which is required for `create()`."
      );
    },
    async findFirst(table, v) {
      const records = await this.findMany(table, {
        ...v,
        limit: 1,
      });

      if (records.length === 0) return null;
      return records[0]!;
    },

    async findMany(table, v) {
      let query = kysely.selectFrom(table._.raw.name);

      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }
      if (v.offset !== undefined) query = query.offset(v.offset);
      if (v.limit !== undefined) query = query.limit(v.limit);
      if (v.orderBy) {
        for (const [col, mode] of v.orderBy) {
          query = query.orderBy(col.getSQLName(), mode);
        }
      }

      const selectBuilder = extendSelect(v.select);
      const mappedSelect: string[] = [];

      if (v.join) {
        for (const join of v.join) {
          const { options: joinOptions, relation } = join;
          if (joinOptions === false) continue;

          if (relation.type === "many") {
            for (const [left] of relation.on) {
              selectBuilder.extend(left);
            }

            continue;
          }

          const target = relation.table;
          const targetAbstract = abstractTables[target.ormName]!;
          // update select
          mappedSelect.push(
            ...mapSelect(joinOptions.select, targetAbstract, relation.ormName)
          );

          query = query.leftJoin(target.name, (b) =>
            b.on((eb) => {
              const conditions = [];
              for (const [left, right] of relation.on) {
                conditions.push(
                  eb(
                    table[left]!.getSQLName(),
                    "=",
                    eb.ref(targetAbstract[right]!.getSQLName())
                  )
                );
              }
              if (joinOptions.where) {
                conditions.push(buildWhere(joinOptions.where, eb, provider));
              }

              return eb.and(conditions);
            })
          );
        }
      }

      const compiledSelect = selectBuilder.compile();
      mappedSelect.push(...mapSelect(compiledSelect.result, table));

      const records = (await query.select(mappedSelect).execute()).map((v) =>
        decodeResult(v, table._.raw)
      );

      if (!v.join) return records;
      await Promise.all(
        v.join.map(async (join) => {
          const { relation, options: joinOptions } = join;
          if (joinOptions === false || relation.type !== "many") return;

          const targetAbstract = abstractTables[relation.table.ormName]!;
          const subSelectBuilder = extendSelect(joinOptions.select);
          const root: Condition = {
            type: ConditionType.Or,
            items: [],
          };

          for (const record of records) {
            const condition: Condition = {
              type: ConditionType.And,
              items: [],
            };

            for (const [left, right] of relation.on) {
              subSelectBuilder.extend(right);

              condition.items.push({
                type: ConditionType.Compare,
                a: targetAbstract[right]!,
                operator: "=",
                b: record[left]!,
              });
            }

            root.items.push(condition);
          }

          const compiledSubSelect = subSelectBuilder.compile();
          const subRecords = await this.findMany(targetAbstract, {
            ...joinOptions,
            select: compiledSubSelect.result,
            where: joinOptions.where
              ? {
                  type: ConditionType.And,
                  items: [root, joinOptions.where],
                }
              : root,
          });

          for (const record of records) {
            // omit result keys if they're only needed for sub queries, and excluded from `select`.

            const filtered = subRecords.filter((subRecord) => {
              for (const [left, right] of relation.on) {
                if (record[left] !== subRecord[right]) return false;
              }

              for (const key of compiledSubSelect.extendedKeys) {
                delete subRecord[key];
              }

              return true;
            });

            record[relation.ormName] = filtered;
            for (const key of compiledSelect.extendedKeys) {
              delete record[key];
            }
          }
        })
      );

      return records;
    },

    async updateMany(from, v) {
      let query = kysely
        .updateTable(from._.raw.name)
        .set(encodeValues(v.set, from, false));
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }
      await query.execute();
    },

    async createMany(table, values) {
      await kysely
        .insertInto(table._.raw.name)
        .values(values.map((v) => encodeValues(v, table, true)))
        .execute();
    },
    async deleteMany(table, v) {
      let query = kysely.deleteFrom(table._.raw.name);
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }
      await query.execute();
    },
  };
}
