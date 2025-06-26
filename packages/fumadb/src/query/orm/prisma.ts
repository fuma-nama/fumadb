import { ORMAdapter } from "./base";
import { AbstractColumn, AbstractTable, Condition, SelectClause } from "..";

// TODO: implement joining tables & comparing values with another table's columns
function buildWhere(condition: Condition): object | boolean {
  if (Array.isArray(condition)) {
    const column = condition[0];
    if (condition.length === 3 && column instanceof AbstractColumn) {
      const [_, op, value] = condition;
      const name = column.name;

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

function mapSelect(select: SelectClause, table: AbstractTable) {
  const out: Record<string, boolean> = {};
  const rawToSelectName = new Map<string, string>();

  function scan(select: SelectClause, parent = "") {
    for (const k in select) {
      if (k === "_") continue;

      const col = select[k];
      const path = parent.length > 0 ? `${parent}.${k}` : k;

      if (col instanceof AbstractColumn) {
        // TODO: remove this when joining table is implemented
        if (col.parent.name !== table._.name)
          throw new Error("Selecting from another table is not supported yet.");

        out[col.name] = true;
        rawToSelectName.set(col.name, path);
      } else if (col) {
        scan(col, path);
      }
    }
  }

  scan(select);

  return [out, rawToSelectName] as const;
}

function mapResult(
  result: Record<string, unknown>,
  rawToSelectName: Map<string, string>
) {
  const mapped: Record<string, unknown> = {};

  for (const k in result) {
    const selectName = rawToSelectName.get(k);
    if (!selectName) continue;

    let cur = mapped;
    selectName.split(".").forEach((seg, i, segs) => {
      if (i < segs.length - 1) {
        cur[seg] ??= {};
        cur = cur[seg] as Record<string, unknown>;
      } else {
        cur[seg] = result[k];
      }
    });
  }

  return mapped;
}

export function fromPrisma(prisma: Prisma): ORMAdapter {
  return {
    findFirst: async (from, v) => {
      const [select, rawToSelectName] = mapSelect(v.select, from);
      let where = v.where ? buildWhere(v.where) : undefined;
      if (where === true) where = {};
      if (where === false) return null;

      return await prisma[from._.name]!.findFirst({
        where: where!,
        select,
      }).then((res) => (res ? mapResult(res, rawToSelectName) : res));
    },
    findMany: async (from, v) => {
      const [select, rawToSelectName] = mapSelect(v.select, from);
      let where = v.where ? buildWhere(v.where) : undefined;
      if (where === true) where = undefined;
      if (where === false) return [];

      const result = await prisma[from._.name]!.findMany({
        where: where!,
        select,
      });

      return result.map((v) => mapResult(v, rawToSelectName));
    },
    updateMany: async (from, v) => {
      let where = v.where ? buildWhere(v.where) : undefined;
      if (where === true) where = undefined;
      if (where === false) return;

      await prisma[from._.name]!.updateMany({ where, data: v.set });
    },
    createMany: async (table, values) => {
      await prisma[table._.name]!.createMany({ data: values });
    },
    deleteMany: async (table, v) => {
      let where = v.where ? buildWhere(v.where) : undefined;
      if (where === true) where = undefined;
      if (where === false) return;

      await prisma[table._.name]!.deleteMany({ where });
    },
  };
}
