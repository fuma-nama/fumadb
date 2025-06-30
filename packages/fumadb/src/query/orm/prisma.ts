import { createTables, ORMAdapter } from "./base";
import {
  AbstractTable,
  Condition,
  ConditionType,
  AnySelectClause,
  AbstractColumn,
} from "..";
import * as Prisma from "../../shared/prisma";
import { Schema } from "../../schema";

// TODO: implement joining tables & comparing values with another table's columns
function buildWhere(condition: Condition): object {
  if (condition.type == ConditionType.Compare) {
    const column = condition.a;
    const value = condition.b;
    const name = column.name;

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

// TODO: implement joining tables
function mapSelect(select: AnySelectClause, _table: AbstractTable) {
  const out: Record<string, boolean> = {};
  if (select === true) return;

  if (Array.isArray(select)) {
    for (const col of select) {
      out[col] = true;
    }

    return out;
  }

  throw new Error(
    "Prisma adapter doesn't support joining tables at the moment"
  );
}

// without joins, the results of Prisma and fumadb are identical
function mapResult(result: Record<string, unknown>) {
  return result;
}

function mapOrderBy(orderBy: [column: AbstractColumn, mode: "asc" | "desc"][]) {
  const out: Prisma.OrderBy = {};

  for (const [col, mode] of orderBy) {
    out[col.name] = mode;
  }

  return out;
}

export function fromPrisma(
  schema: Schema,
  prisma: Prisma.PrismaClient
): ORMAdapter {
  return {
    tables: createTables(schema),
    async findFirst(from, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      return await prisma[from._.name]!.findFirst({
        where: where!,
        select: mapSelect(v.select, from),
        skip: v.offset,
        orderBy: v.orderBy ? mapOrderBy(v.orderBy) : undefined,
      }).then((res) => (res ? mapResult(res) : res));
    },
    async findMany(from, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      const result = await prisma[from._.name]!.findMany({
        where: where!,
        select: mapSelect(v.select, from),
        skip: v.offset,
        take: v.limit,
        orderBy: v.orderBy ? mapOrderBy(v.orderBy) : undefined,
      });

      return result.map((v) => mapResult(v));
    },
    async updateMany(from, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[from._.name]!.updateMany({ where, data: v.set });
    },
    async create(table, values) {
      return await prisma[table._.name]!.create({
        data: values,
      });
    },
    async createMany(table, values) {
      await prisma[table._.name]!.createMany({ data: values });
    },
    async deleteMany(table, v) {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[table._.name]!.deleteMany({ where });
    },
  };
}
