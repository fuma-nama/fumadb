import { ORMAdapter } from "./base";
import {
  AbstractColumn,
  AbstractTable,
  Condition,
  ConditionType,
  SelectClause,
} from "..";
import { PrismaClient } from "../../shared/config";

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

  return {
    OR: condition.items.map(buildWhere),
  };
}

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

export function fromPrisma(prisma: PrismaClient): ORMAdapter {
  return {
    findFirst: async (from, v) => {
      const [select, rawToSelectName] = mapSelect(v.select, from);
      const where = v.where ? buildWhere(v.where) : undefined;

      return await prisma[from._.name]!.findFirst({
        where: where!,
        select,
      }).then((res) => (res ? mapResult(res, rawToSelectName) : res));
    },
    findMany: async (from, v) => {
      const [select, rawToSelectName] = mapSelect(v.select, from);
      const where = v.where ? buildWhere(v.where) : undefined;

      const result = await prisma[from._.name]!.findMany({
        where: where!,
        select,
      });

      return result.map((v) => mapResult(v, rawToSelectName));
    },
    updateMany: async (from, v) => {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[from._.name]!.updateMany({ where, data: v.set });
    },
    createMany: async (table, values) => {
      await prisma[table._.name]!.createMany({ data: values });
    },
    deleteMany: async (table, v) => {
      const where = v.where ? buildWhere(v.where) : undefined;

      await prisma[table._.name]!.deleteMany({ where });
    },
  };
}
