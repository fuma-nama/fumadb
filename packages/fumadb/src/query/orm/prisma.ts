import {
  createTables,
  getAbstractTableKeys,
  ORMAdapter,
  SimplifyFindOptions,
} from "./base";
import {
  AbstractTable,
  AnySelectClause,
  AbstractColumn,
  FindManyOptions,
} from "..";
import * as Prisma from "../../shared/prisma";
import { AnySchema } from "../../schema";
import { Condition, ConditionType } from "../condition-builder";

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

function mapSelect(select: AnySelectClause, table: AbstractTable) {
  const out: Record<string, boolean> = {};
  if (select === true) select = getAbstractTableKeys(table);

  for (const col of select) {
    out[col] = true;
  }

  return out;
}

function mapOrderBy(orderBy: [column: AbstractColumn, mode: "asc" | "desc"][]) {
  const out: Prisma.OrderBy = {};

  for (const [col, mode] of orderBy) {
    out[col.name] = mode;
  }

  return out;
}

export function fromPrisma(
  schema: AnySchema,
  prisma: Prisma.PrismaClient
): ORMAdapter {
  const abstractTables = createTables(schema);

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

  return {
    tables: abstractTables,
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
