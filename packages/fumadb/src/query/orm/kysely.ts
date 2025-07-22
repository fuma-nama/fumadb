import {
  BinaryOperator,
  ExpressionBuilder,
  ExpressionWrapper,
  Kysely,
  sql,
} from "kysely";
import { CompiledJoin, createTables, SimplifyFindOptions, toORM } from "./base";
import {
  AbstractColumn,
  AbstractQuery,
  AnySelectClause,
  FindManyOptions,
} from "..";
import { SqlBool } from "kysely";
import { AnySchema, AnyTable } from "../../schema";
import { SQLProvider } from "../../shared/providers";
import { Condition, ConditionType } from "../condition-builder";
import {
  deserialize,
  getRuntimeDefaultValue,
  serialize,
} from "../../schema/serialize";

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
      val = serialize(val, left.raw, provider);
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

function mapSelect(
  select: AnySelectClause,
  table: AnyTable,
  options: {
    parent?: string;
    tableName?: string;
  } = {}
): string[] {
  const { parent, tableName } = options;
  const out: string[] = [];
  const keys = Array.isArray(select) ? select : Object.keys(table.columns);

  for (const col of keys) {
    const name = parent ? parent + ":" + col : col;

    out.push(`${table.columns[col]!.getSQLName(tableName)} as ${name}`);
  }

  return out;
}

function extendSelect(original: AnySelectClause): {
  extend: (key: string) => void;
  compile: () => {
    result: AnySelectClause;
    extendedKeys: string[];
    /**
     * It doesn't create new object
     */
    removeExtendedKeys: (
      record: Record<string, unknown>
    ) => Record<string, unknown>;
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
        removeExtendedKeys(record) {
          for (const key of extendedKeys) {
            delete record[key];
          }
          return record;
        },
      };
    },
  };
}

// always use raw SQL names since Kysely is a query builder
export function fromKysely(
  schema: AnySchema,
  kysely: Kysely<any>,
  provider: SQLProvider
): AbstractQuery<AnySchema> {
  const abstractTables = createTables(schema);

  /**
   * Transform object keys and encode values (e.g. for SQLite, date -> number)
   */
  function encodeValues(
    values: Record<string, unknown>,
    table: AnyTable,
    generateDefault: boolean
  ) {
    const result: Record<string, unknown> = {};

    for (const k in table.columns) {
      const col = table.columns[k]!;
      let value = values[k];

      if (generateDefault && value === undefined) {
        value = getRuntimeDefaultValue(col, provider);
      }

      result[col.name] = serialize(value, col, provider);
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
        output[k] = deserialize(value, table.columns[k]!, provider);
      }

      if (segs.length === 2) {
        const [relationName, colName] = segs as [string, string];
        const relation = table.relations[relationName];
        if (relation === undefined) continue;
        const col = relation.table.columns[colName];
        if (col === undefined) continue;

        output[relationName] ??= {};
        const obj = output[relationName] as Record<string, unknown>;
        obj[colName] = deserialize(value, col, provider);
      }
    }

    return output;
  }

  async function findMany(
    table: AnyTable,
    v: SimplifyFindOptions<FindManyOptions>
  ) {
    let query = kysely.selectFrom(table.name);

    const where = v.where;
    if (where) {
      query = query.where((eb) => buildWhere(where, eb, provider));
    }

    if (v.offset !== undefined) {
      query = query.offset(v.offset);
    }

    if (v.limit !== undefined) {
      query = provider === "mssql" ? query.top(v.limit) : query.limit(v.limit);
    }

    if (v.orderBy) {
      for (const [col, mode] of v.orderBy) {
        query = query.orderBy(col.getSQLName(), mode);
      }
    }

    const selectBuilder = extendSelect(v.select);
    const mappedSelect: string[] = [];
    const subqueryJoins: CompiledJoin[] = [];
    let onDecodeRecord = (record: Record<string, unknown>) =>
      decodeResult(record, table);

    if (v.join) {
      for (const join of v.join) {
        const { options: joinOptions, relation } = join;
        if (joinOptions === false) continue;

        if (relation.type === "many" || joinOptions.join) {
          subqueryJoins.push(join);
          for (const [left] of relation.on) {
            selectBuilder.extend(left);
          }

          continue;
        }

        const targetTable = relation.table;
        const joinName = relation.ormName;
        // update select
        mappedSelect.push(
          ...mapSelect(joinOptions.select, targetTable, {
            parent: joinName,
            tableName: joinName,
          })
        );

        const currentDecode = onDecodeRecord;
        onDecodeRecord = (record) => {
          const result = currentDecode(record);

          if (result[joinName]) {
            result[joinName] = decodeResult(
              result[joinName] as Record<string, unknown>,
              targetTable
            );
          }

          return result;
        };
        query = query.leftJoin(`${targetTable.name} as ${joinName}`, (b) =>
          b.on((eb) => {
            const conditions = [];
            for (const [left, right] of relation.on) {
              conditions.push(
                eb(
                  table.columns[left]!.getSQLName(),
                  "=",
                  eb.ref(targetTable.columns[right]!.getSQLName(joinName))
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

    const records = (await query.select(mappedSelect).execute()).map(
      onDecodeRecord
    );

    if (subqueryJoins.length === 0) return records;
    await Promise.all(
      subqueryJoins.map(async (join) => {
        const { relation, options: joinOptions } = join;
        if (joinOptions === false) return;

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
        const subRecords = await findMany(relation.table, {
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
          const filtered = subRecords.filter((subRecord) => {
            for (const [left, right] of relation.on) {
              if (record[left] !== subRecord[right]) return false;
            }

            compiledSubSelect.removeExtendedKeys(subRecord);
            return true;
          });

          record[relation.ormName] =
            relation.type === "one" ? (filtered[0] ?? null) : filtered;
          compiledSelect.removeExtendedKeys(record);
        }
      })
    );

    return records;
  }

  return toORM({
    tables: abstractTables,
    async count(table, { where }) {
      let query = await kysely
        .selectFrom(table._.raw.name)
        .select(kysely.fn.countAll().as("count"));
      if (where) query = query.where((b) => buildWhere(where, b, provider));

      const result = await query.executeTakeFirstOrThrow();

      const count = Number(result.count);
      if (Number.isNaN(count))
        throw new Error("Unexpected result for count, received: " + count);

      return count;
    },
    async create(table, values) {
      const rawTable = table._.raw;
      const insertValues = encodeValues(values, rawTable, true);
      let insert = kysely.insertInto(rawTable.name).values(insertValues);

      if (provider === "mssql") {
        return decodeResult(
          await insert
            .output(
              mapSelect(true, rawTable, { tableName: "inserted" }) as any[]
            )
            .executeTakeFirstOrThrow(),
          rawTable
        );
      }

      if (provider === "postgresql" || provider === "sqlite") {
        return decodeResult(
          await insert
            .returning(mapSelect(true, rawTable))
            .executeTakeFirstOrThrow(),
          rawTable
        );
      }

      const idColumn = rawTable.getIdColumn();
      const idValue = values[idColumn.name];

      if (idValue == null)
        throw new Error(
          "cannot find value of id column, which is required for `create()`."
        );

      await insert.execute();
      return decodeResult(
        await kysely
          .selectFrom(rawTable.name)
          .select(mapSelect(true, rawTable))
          .where(idColumn.name, "=", idValue)
          .limit(1)
          .executeTakeFirstOrThrow(),
        rawTable
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
      return findMany(table._.raw, v);
    },

    async updateMany(table, v) {
      let query = kysely
        .updateTable(table._.raw.name)
        .set(encodeValues(v.set, table._.raw, false));
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }
      await query.execute();
    },
    async upsert(table, { where, update, create }) {
      const rawTable = table._.raw;

      if (provider === "mssql") {
        let query = kysely
          .updateTable(rawTable.name)
          .top(1)
          .set(encodeValues(update, rawTable, false));

        if (where) query = query.where((b) => buildWhere(where, b, provider));
        const result = await query.executeTakeFirstOrThrow();

        if (result.numUpdatedRows === 0n)
          await this.createMany(table, [create]);
        return;
      }

      const idColumn = rawTable.getIdColumn();
      let query = kysely
        .selectFrom(rawTable.name)
        .select([`${idColumn.name} as id`]);
      if (where) query = query.where((b) => buildWhere(where, b, provider));
      const result = await query.limit(1).executeTakeFirst();

      if (result) {
        await kysely
          .updateTable(rawTable.name)
          .set(encodeValues(update, rawTable, false))
          .where(idColumn.name, "=", result.id)
          .execute();
      } else {
        await this.createMany(table, [create]);
      }
    },

    async createMany(table, values) {
      const rawTable = table._.raw;
      const encodedValues = values.map((v) => encodeValues(v, rawTable, true));
      await kysely.insertInto(rawTable.name).values(encodedValues).execute();

      return encodedValues.map((value) => ({
        _id: value[rawTable.getIdColumn().name],
      }));
    },
    async deleteMany(table, v) {
      let query = kysely.deleteFrom(table._.raw.name);
      if (v.where) {
        query = query.where((eb) => buildWhere(v.where!, eb, provider));
      }
      await query.execute();
    },
    transaction(run) {
      return kysely
        .transaction()
        .execute((ctx) => run(fromKysely(schema, ctx, provider)));
    },
  });
}
