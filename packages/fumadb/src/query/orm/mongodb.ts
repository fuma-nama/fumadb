import { createTables, ORMAdapter } from "./base";
import { Db, Document, Filter, ObjectId } from "mongodb";
import { AbstractTable, AnySelectClause, AbstractColumn } from "..";
import { AnySchema } from "../../schema";
import { Condition, ConditionType } from "../condition-builder";

export type MongoDBClient = Db;

// TODO: implement joining tables & comparing values with another table's columns
function buildWhere(condition: Condition): Filter<Document> {
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
        return { [name]: { $ne: value } };
      case ">":
        return { [name]: { $gt: value } };
      case ">=":
        return { [name]: { $gte: value } };
      case "<":
        return { [name]: { $lt: value } };
      case "<=":
        return { [name]: { $lte: value } };
      case "in":
        return { [name]: { $in: value } };
      case "not in":
        return { [name]: { $nin: value } };
      case "starts with":
        return { [name]: { $regex: `^${value}`, $options: "i" } };
      case "not starts with":
        return { [name]: { $not: { $regex: `^${value}`, $options: "i" } } };
      case "contains":
        return { [name]: { $regex: value, $options: "i" } };
      case "not contains":
        return { [name]: { $not: { $regex: value, $options: "i" } } };
      case "ends with":
        return { [name]: { $regex: `${value}$`, $options: "i" } };
      case "not ends with":
        return { [name]: { $not: { $regex: `${value}$`, $options: "i" } } };
      default:
        throw new Error(`Unsupported operator: ${condition.operator}`);
    }
  }

  if (condition.type === ConditionType.And) {
    return {
      $and: condition.items.map(buildWhere),
    };
  }

  if (condition.type === ConditionType.Not) {
    return {
      $not: buildWhere(condition),
    };
  }

  return {
    $or: condition.items.map(buildWhere),
  };
}

// TODO: implement joining tables
function mapSelect(
  select: AnySelectClause,
  table: AbstractTable
): Document | undefined {
  const out: Document = {};
  if (select === true) return;

  if (Array.isArray(select)) {
    const idName = table._.idColumnName;
    let excludeId = true;

    for (const col of select) {
      if (idName && col === idName) {
        excludeId = false;
        continue;
      }

      out[col] = 1;
    }

    if (excludeId) out._id = 0;

    return out;
  }

  throw new Error(
    "MongoDB adapter doesn't support joining tables at the moment"
  );
}

function mapSort(orderBy: [column: AbstractColumn, "asc" | "desc"][]) {
  const out: Record<string, 1 | -1> = {};

  for (const [col, mode] of orderBy) {
    const name = col.isID() ? "_id" : col.name;

    out[name] = mode === "asc" ? 1 : -1;
  }

  return out;
}

function mapInsertValues(
  values: Record<string, unknown>,
  table: AbstractTable
) {
  const out: Record<string, unknown> = {};
  const idName = table._.idColumnName;

  for (const k in values) {
    const value = values[k];

    if (k === idName && value) {
      out._id = value;
      continue;
    }

    out[k] = value;
  }

  return out;
}

function mapResult(
  result: Record<string, unknown>,
  table: AbstractTable
): Record<string, unknown> {
  const idColumn = table._.idColumnName;
  if (!idColumn) return result;

  if ("_id" in result) {
    const id = result._id;
    delete result._id;
    result[idColumn] = id instanceof ObjectId ? id.toString("hex") : id;
  }

  return result;
}

// MongoDB has no raw SQL name, uses ORM name for all operations
export function fromMongoDB(
  schema: AnySchema,
  client: MongoDBClient
): ORMAdapter {
  return {
    tables: createTables(schema),
    async findFirst(from, v) {
      const result = await this.findMany(from, {
        ...v,
        limit: 1,
      });

      if (result.length === 0) return null;
      return result[0]!;
    },
    async findMany(from, v) {
      const where = v.where ? buildWhere(v.where) : {};
      let query = client.collection(from._.name).find(where, {
        projection: mapSelect(v.select, from),
      });

      if (v.limit !== undefined) query = query.limit(v.limit);
      if (v.offset !== undefined) query = query.skip(v.offset);
      if (v.orderBy) {
        query = query.sort(mapSort(v.orderBy));
      }

      const result = await query.toArray();
      return result.map((v) => mapResult(v, from));
    },
    async updateMany(from, v) {
      const where = v.where ? buildWhere(v.where) : {};

      await client
        .collection(from._.name)
        .updateMany(where, { $set: mapInsertValues(v.set, from) });
    },
    async create(table, values) {
      const collection = client.collection(table._.name);
      const { insertedId } = await collection.insertOne(
        mapInsertValues(values, table)
      );

      const result = await collection.findOne({
        _id: insertedId,
      });

      if (result === null)
        throw new Error(
          "Failed to insert document: cannot find inserted coument."
        );
      return mapResult(result, table);
    },
    async createMany(table, values) {
      await client
        .collection(table._.name)
        .insertMany(values.map((v) => mapInsertValues(v, table)));
    },
    async deleteMany(table, v) {
      const where = v.where ? buildWhere(v.where) : {};

      await client.collection(table._.name).deleteMany(where);
    },
  };
}
