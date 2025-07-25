import { createTables, SimplifyFindOptions, toORM } from "./base";
import {
  AnySelectClause,
  AbstractColumn,
  FindManyOptions,
  AbstractQuery,
} from "..";
import * as Prisma from "../../shared/prisma";
import { AnyColumn, AnySchema, AnyTable } from "../../schema";
import { Condition, ConditionType } from "../condition-builder";
import { createId } from "fumadb/cuid";
import { PrismaConfig } from "../../shared/config";
import { checkForeignKeyOnInsert } from "../polyfills/foreign-key";

// TODO: implement comparing values with another table's columns
function buildWhere(condition: Condition): object {
  if (condition.type == ConditionType.Compare) {
    const column = condition.a;
    const value = condition.b;
    const name = column.raw.names.prisma;

    if (value instanceof AbstractColumn) {
      throw new Error(
        "Prisma adapter does not support comparing against another column at the moment."
      );
    }

    switch (condition.operator) {
      case "=":
      case "is":
        return { [name]: value };
      case "!=":
      case "<>":
      case "is not":
        return { [name]: { not: value } };
      case ">":
        return { [name]: { gt: value } };
      case ">=":
        return { [name]: { gte: value } };
      case "<":
        return { [name]: { lt: value } };
      case "<=":
        return { [name]: { lte: value } };
      case "in":
        return { [name]: { in: value } };
      case "not in":
        return { [name]: { notIn: value } };
      case "starts with":
        return { [name]: { startsWith: value } };
      case "not starts with":
        return { NOT: { [name]: { startsWith: value } } };
      case "contains":
        return { [name]: { contains: value } };
      case "not contains":
        return { NOT: { [name]: { contains: value } } };
      case "ends with":
        return { [name]: { endsWith: value } };
      case "not ends with":
        return { NOT: { [name]: { endsWith: value } } };
      default:
        throw new Error(`Unsupported operator: ${condition.operator}`);
    }
  }

  if (condition.type === ConditionType.And) {
    return {
      AND: condition.items.map(buildWhere),
    };
  }

  if (condition.type === ConditionType.Not) {
    return {
      NOT: condition,
    };
  }

  return {
    OR: condition.items.map(buildWhere),
  };
}

function mapSelect(select: AnySelectClause, table: AnyTable) {
  const out: Record<string, boolean> = {};

  if (select === true) {
    for (const col of Object.values(table.columns)) {
      out[col.names.prisma] = true;
    }
  } else {
    for (const col of select) {
      out[table.columns[col].names.prisma] = true;
    }
  }

  return out;
}

function mapOrderBy(orderBy: [column: AbstractColumn, mode: "asc" | "desc"][]) {
  const out: Prisma.OrderBy = {};

  for (const [col, mode] of orderBy) {
    out[col.raw.names.prisma] = mode;
  }

  return out;
}

function mapResult(result: Record<string, unknown>, table: AnyTable) {
  const out: Record<string, unknown> = {};

  for (const k in result) {
    let value = result[k];

    if (k in table.relations) {
      const relation = table.relations[k];
      if (relation.type === "many") {
        out[k] = (value as Record<string, unknown>[]).map((v) =>
          mapResult(v, relation.table)
        );
      } else {
        out[k] = value ? mapResult(value as any, relation.table) : null;
      }

      continue;
    }

    const col = table.getColumnByName(k, "prisma");
    if (col) out[col.ormName] = value;
  }

  return out;
}

export function fromPrisma(
  schema: AnySchema,
  config: PrismaConfig & {
    isTransaction?: boolean;
  }
): AbstractQuery<AnySchema> {
  const abstractTables = createTables(schema);
  const {
    provider,
    prisma,
    relationMode = provider === "mongodb" ? "prisma" : "foreign-keys",
    db: internalClient,
    isTransaction = false,
  } = config;

  // replace index with partial index to ignore null values
  // see https://github.com/prisma/prisma/issues/3387
  async function indexMongoDB() {
    if (!internalClient || isTransaction) return;
    const db = internalClient.db();

    for (const table of Object.values(schema.tables)) {
      const collection = db.collection(table.names.mongodb);
      const indexes = await collection.indexes();

      for (const index of indexes) {
        if (!index.unique || !index.name || index.sparse) continue;

        await collection.dropIndex(index.name);
        await collection.createIndex(index.key, {
          name: index.name,
          unique: true,
          sparse: true,
        });
      }
    }
  }

  void indexMongoDB();

  function createFindOptions(
    table: AnyTable,
    v: SimplifyFindOptions<FindManyOptions>
  ) {
    const where = v.where ? buildWhere(v.where) : undefined;
    const select: Record<string, unknown> = mapSelect(v.select, table);

    if (v.join) {
      for (const { relation, options: joinOptions } of v.join) {
        if (joinOptions === false) continue;

        select[relation.name] = createFindOptions(relation.table, joinOptions);
      }
    }

    return {
      where,
      select,
      skip: v.offset,
      take: v.limit,
      orderBy: v.orderBy ? mapOrderBy(v.orderBy) : undefined,
    };
  }

  function generateDefaultValue(col: AnyColumn) {
    if (!col.default) return;
    if (col.default === "auto") return createId();
    if (col.default === "now") return new Date(Date.now());
    if ("value" in col.default) return col.default.value;
  }

  function mapValues(
    table: AnyTable,
    values: Record<string, unknown>,
    generateDefault = false
  ) {
    const out: Record<string, unknown> = {};

    for (const col of Object.values(table.columns)) {
      let value = values[col.ormName];
      if (value === undefined && generateDefault)
        value = generateDefaultValue(col);

      out[col.names.prisma] = value;
    }

    return out;
  }

  return toORM({
    tables: abstractTables,
    async count({ _: { raw } }, v) {
      return (
        await prisma[raw.names.prisma].count({
          select: {
            _all: true,
          },
          where: v.where ? buildWhere(v.where) : undefined,
        })
      )._all;
    },
    async findFirst({ _: { raw } }, v) {
      const options = createFindOptions(raw, v);
      delete options.take;

      const result = await prisma[raw.names.prisma].findFirst({
        ...options,
        where: options.where!,
      });
      if (result) return mapResult(result, raw);

      return null;
    },
    async findMany({ _: { raw } }, v) {
      return (
        await prisma[raw.names.prisma].findMany(createFindOptions(raw, v))
      ).map((v) => mapResult(v, raw));
    },
    async updateMany({ _: { raw } }, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[raw.names.prisma].updateMany({ where, data: v.set });
    },
    async create({ _: { raw } }, values) {
      if (relationMode === "prisma") {
        await Promise.all(
          raw.foreignKeys.map((key) =>
            checkForeignKeyOnInsert(this, key, [values])
          )
        );
      }

      values = mapValues(raw, values, true);
      return mapResult(
        await prisma[raw.names.prisma].create({
          data: values,
        }),
        raw
      );
    },
    async createMany({ _: { raw } }, values) {
      const idField = raw.getIdColumn().names.prisma;
      if (relationMode === "prisma") {
        await Promise.all(
          raw.foreignKeys.map((key) =>
            checkForeignKeyOnInsert(this, key, values)
          )
        );
      }

      values = values.map((value) => mapValues(raw, value, true));
      await prisma[raw.names.prisma].createMany({ data: values });
      return values.map((value) => ({ _id: value[idField] }));
    },
    async deleteMany({ _: { raw } }, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[raw.names.prisma].deleteMany({ where });
    },
    async upsert({ _: { raw } }, { where, ...v }) {
      await prisma[raw.names.prisma].upsert({
        where: where ? buildWhere(where) : {},
        create: mapValues(raw, v.create, true),
        update: mapValues(raw, v.update),
      });
    },
    transaction(run) {
      return prisma.$transaction((tx) =>
        run(
          fromPrisma(schema, {
            ...config,
            isTransaction: true,
            prisma: tx,
          })
        )
      );
    },
  });
}
