import {
  checkForeignKeyOnInsert,
  createTables,
  SimplifyFindOptions,
  toORM,
} from "./base";
import {
  AbstractTable,
  AnySelectClause,
  AbstractColumn,
  FindManyOptions,
  AbstractQuery,
} from "..";
import * as Prisma from "../../shared/prisma";
import { AnyColumn, AnySchema, AnyTable } from "../../schema";
import { Condition, ConditionType } from "../condition-builder";
import { createId } from "fumadb/cuid";
import { Provider } from "../../shared/providers";

// TODO: implement comparing values with another table's columns
function buildWhere(condition: Condition): object {
  if (condition.type == ConditionType.Compare) {
    const column = condition.a;
    const value = condition.b;
    const name = column.raw.ormName;

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

function mapSelect(select: AnySelectClause, table: AbstractTable) {
  const out: Record<string, boolean> = {};
  if (select === true) select = Object.keys(table._.raw.columns);

  for (const col of select) {
    out[col] = true;
  }

  return out;
}

function mapOrderBy(orderBy: [column: AbstractColumn, mode: "asc" | "desc"][]) {
  const out: Prisma.OrderBy = {};

  for (const [col, mode] of orderBy) {
    out[col.raw.ormName] = mode;
  }

  return out;
}

export function fromPrisma(
  schema: AnySchema,
  prisma: Prisma.PrismaClient,
  provider: Provider,
  config: Prisma.PrismaConfig & {
    isTransaction?: boolean;
  }
): AbstractQuery<AnySchema> {
  const abstractTables = createTables(schema);
  const {
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
      const collection = db.collection(table.ormName);
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
    table: AbstractTable,
    v: SimplifyFindOptions<FindManyOptions>
  ) {
    const where = v.where ? buildWhere(v.where) : undefined;
    const select: Record<string, unknown> = mapSelect(v.select, table);

    if (v.join) {
      for (const { relation, options: joinOptions } of v.join) {
        if (joinOptions === false) continue;

        select[relation.ormName] = createFindOptions(
          abstractTables[relation.table.ormName]!,
          joinOptions
        );
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

  function mapInsertValues(table: AnyTable, values: Record<string, unknown>) {
    for (const k in table.columns) {
      const col = table.columns[k];
      let value = values[k];

      if (value === undefined) value = generateDefaultValue(col);

      values[k] = value;
    }

    return values;
  }

  return toORM({
    tables: abstractTables,
    async count(table, v) {
      return (
        await prisma[table._.name]!.count({
          select: {
            _all: true,
          },
          where: v.where ? buildWhere(v.where) : undefined,
        })
      )._all!;
    },
    async findFirst(from, v) {
      const options = createFindOptions(from, v);
      delete options.take;

      return await prisma[from._.name]!.findFirst(options as any);
    },
    async findMany(from, v) {
      return await prisma[from._.name]!.findMany(createFindOptions(from, v));
    },
    async updateMany(from, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[from._.name]!.updateMany({ where, data: v.set });
    },
    async create(table, values) {
      const rawTable = table._.raw;
      values = mapInsertValues(rawTable, values);

      if (relationMode === "prisma") {
        await Promise.all(
          rawTable.foreignKeys.map((key) =>
            checkForeignKeyOnInsert(this, key, [values])
          )
        );
      }

      return await prisma[rawTable.ormName].create({
        data: values,
      });
    },
    async createMany(table, values) {
      const rawTable = table._.raw;
      const idColumn = rawTable.getIdColumn();
      values = values.map((value) => mapInsertValues(rawTable, value));

      if (relationMode === "prisma") {
        await Promise.all(
          rawTable.foreignKeys.map((key) =>
            checkForeignKeyOnInsert(this, key, values)
          )
        );
      }

      await prisma[table._.name]!.createMany({ data: values });
      return values.map((value) => ({ _id: value[idColumn.ormName] }));
    },
    async deleteMany(table, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[table._.name]!.deleteMany({ where });
    },
    async upsert(table, { where, ...v }) {
      await prisma[table._.name]!.upsert({
        where: where ? buildWhere(where) : {},
        ...v,
      });
    },
    transaction(run) {
      return prisma.$transaction((tx) =>
        run(
          fromPrisma(schema, tx, provider, {
            ...config,
            isTransaction: true,
          })
        )
      );
    },
  });
}
