import { ORMAdapter } from "./base";
import { Condition } from "..";
import { z } from "zod";

const columnSchema = z.object({
  name: z.string(),
});

// Converts a Condition to Prisma's where object
function buildWhere(condition: Condition): object | boolean {
  if (Array.isArray(condition)) {
    const column = columnSchema.safeParse(condition[0]);
    if (condition.length === 3 && column.success) {
      const [_, op, value] = condition;
      const name = column.data.name;
      switch (op) {
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
          throw new Error(`Unsupported operator: ${op}`);
      }
    }

    // Nested conditions: [cond1, "and", cond2, ...]
    const isAnd = condition.includes("and" as any);
    const filters: object[] = [];
    for (const child of condition) {
      if (typeof child === "string") continue;

      const filter = buildWhere(child as Condition);
      if (filter === true) {
        if (isAnd) continue;
        return true;
      }

      if (filter === false) {
        if (isAnd) return false;
        continue;
      }

      filters.push(filter);
    }

    if (isAnd) return filters.length > 0 ? { AND: filters } : true;
    return filters.length > 0 ? { OR: filters } : false;
  } else if (typeof condition === "boolean") {
    return condition;
  }

  throw new Error("Invalid condition: " + JSON.stringify(condition));
}

type Prisma = Record<
  string,
  {
    create: (options: {
      data: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;

    createMany: (options: { data: Record<string, unknown>[] }) => Promise<void>;

    delete: (options: { where: object }) => Promise<Record<string, unknown>>;

    deleteMany: (options: { where?: object }) => Promise<void>;

    findFirst: (options: {
      where: object;
      select?: Record<string, boolean>;
    }) => Promise<Record<string, unknown> | null>;

    findMany: (options: {
      where?: object;
      select?: Record<string, boolean>;
    }) => Promise<Record<string, unknown>[]>;

    updateMany: (options: {
      where?: object;
      data: Record<string, unknown>;
    }) => Promise<void>;
  }
>;

export function fromPrisma(prisma: Prisma): ORMAdapter {
  return {
    findOne: async (from, v) => {
      let where = buildWhere(v.where);
      if (where === true) where = {};
      if (where === false) return null;

      const select = v.select === true ? undefined : v.select;
      return await prisma[from]!.findFirst({ where, select });
    },
    findMany: async (from, v) => {
      let where = v.where ? buildWhere(v.where) : undefined;
      if (where === true) where = undefined;
      if (where === false) return [];

      const select = v.select === true ? undefined : v.select;
      return await prisma[from]!.findMany({ where, select });
    },
    updateMany: async (from, v) => {
      let where = v.where ? buildWhere(v.where) : undefined;
      if (where === true) where = undefined;
      if (where === false) return;

      await prisma[from]!.updateMany({ where, data: v.set });
    },
    createOne: async (table, values) => {
      return await prisma[table]!.create({ data: values }).catch(() => null);
    },
    createMany: async (table, values) => {
      await prisma[table]!.createMany({ data: values });
    },
    deleteOne: async (table, v) => {
      let where = buildWhere(v.where);
      if (where === true) where = {};
      if (where === false) return null;

      return await prisma[table]!.delete({ where });
    },
    deleteMany: async (table, v) => {
      let where = v.where ? buildWhere(v.where) : undefined;
      if (where === true) where = undefined;
      if (where === false) return;

      await (prisma as any)[table]!.deleteMany({ where });
    },
  };
}
