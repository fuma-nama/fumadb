import {
  createTables,
  getAbstractTableKeys,
  ORMAdapter,
  SimplifyFindOptions,
} from "./base";
import { Binary, Db, Document, Filter, ObjectId } from "mongodb";
import {
  AbstractTable,
  AnySelectClause,
  AbstractColumn,
  FindManyOptions,
} from "..";
import { AnySchema, Column } from "../../schema";
import { Condition, ConditionType } from "../condition-builder";

export type MongoDBClient = Db;

// TODO: implement joining tables & comparing values with another table's columns
function buildWhere(condition: Condition): Filter<Document> {
  if (condition.type == ConditionType.Compare) {
    const column = condition.a;
    const value = condition.b;
    let name = column.name;
    if (column.isID()) name = "_id";
    if (value instanceof Column)
      throw new Error(
        "MongoDB adapter does not support comparing against another column at the moment."
      );

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

function mapProjection(
  select: AnySelectClause,
  table: AbstractTable
): Document {
  const out: Document = {
    _id: 0,
  };

  const idName = table._.idColumnName;

  for (const col of Array.isArray(select)
    ? select
    : getAbstractTableKeys(table)) {
    out[col] = col === idName ? "$_id" : 1;
  }

  return out;
}

function mapSort(orderBy: [column: AbstractColumn, "asc" | "desc"][]) {
  const out: Record<string, 1 | -1> = {};

  for (const [col, mode] of orderBy) {
    const name = col.isID() ? "_id" : col.name;

    out[name] = mode === "asc" ? 1 : -1;
  }

  return out;
}

enum ValuesMode {
  Insert,
  Update,
}

function mapValues(
  mode: ValuesMode,
  values: Record<string, unknown>,
  table: AbstractTable
) {
  const out: Record<string, unknown> = {};
  for (const k in table) {
    if (k === "_") continue;
    if (mode === ValuesMode.Update && values[k] === undefined) continue;

    const value = values[k] ?? null;

    if (k === table._.idColumnName) {
      out._id = value;
      continue;
    }

    if (value instanceof Uint8Array) {
      out[k] = new Binary(value);
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
  for (const k in result) {
    const value = result[k];

    if (k === "_id") {
      delete result._id;
      result[table._.idColumnName] =
        value instanceof ObjectId ? value.toString("hex") : value;
      continue;
    }

    if (value instanceof Binary) {
      const buffer = value.buffer;
      result[k] =
        buffer instanceof Buffer
          ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
          : buffer;
      continue;
    }
  }

  return result;
}

// MongoDB has no raw SQL name, uses ORM name for all operations
export function fromMongoDB(
  schema: AnySchema,
  client: MongoDBClient
): ORMAdapter {
  const abstractTables = createTables(schema);

  function buildFindPipeline(
    table: AbstractTable,
    v: SimplifyFindOptions<FindManyOptions>
  ) {
    const pipeline: Document[] = [];
    const where = v.where ? buildWhere(v.where) : undefined;

    if (where) pipeline.push({ $match: where });
    if (v.limit !== undefined)
      pipeline.push({
        $limit: v.limit,
      });
    if (v.offset !== undefined)
      pipeline.push({
        $skip: v.offset,
      });
    if (v.orderBy) {
      pipeline.push({ $sort: mapSort(v.orderBy) });
    }
    const project = mapProjection(v.select, table);

    if (v.join) {
      for (const { relation, options: joinOptions } of v.join) {
        project[relation.ormName] = 1;

        if (joinOptions === false) continue;
        const vars: Record<string, string> = {};
        for (const [left] of relation.on) {
          vars[left] = `$${table[left]!.isID() ? "_id" : left}`;
        }

        const targetTable = abstractTables[relation.table.ormName]!;
        pipeline.push({
          $lookup: {
            from: relation.table.ormName,
            let: vars,
            pipeline: [
              ...relation.on.map(([left, right]) => {
                return {
                  $match: {
                    $expr: {
                      $eq: [
                        `$${targetTable[right]?.isID() ? "_id" : right}`,
                        `$$${left}`,
                      ],
                    },
                  },
                };
              }),
              ...buildFindPipeline(targetTable, {
                ...joinOptions,
                limit: relation.type === "many" ? joinOptions.limit : 1,
              }),
            ],
            as: relation.ormName,
          },
        });

        if (relation.type === "one") {
          pipeline.push({
            $unwind: {
              path: `$${relation.ormName}`,
              preserveNullAndEmptyArrays: true,
            },
          });
        }
      }
    }

    pipeline.push({
      $project: project,
    });

    return pipeline;
  }

  return {
    tables: abstractTables,
    async count(table, { where }) {
      return await client
        .collection(table._.name)
        .countDocuments(where ? buildWhere(where) : undefined);
    },
    async findFirst(from, v) {
      const result = await this.findMany(from, {
        ...v,
        limit: 1,
      });

      if (result.length === 0) return null;
      return result[0]!;
    },
    async findMany(from, v) {
      const query = client
        .collection(from._.name)
        .aggregate(buildFindPipeline(from, v));
      const result = await query.toArray();
      return result.map((v) => mapResult(v, from));
    },
    async updateMany(from, v) {
      const where = v.where ? buildWhere(v.where) : {};

      await client
        .collection(from._.name)
        .updateMany(where, { $set: mapValues(ValuesMode.Update, v.set, from) });
    },
    async upsert(table, v) {
      const collection = client.collection(table._.name);

      const result = await collection.updateOne(
        v.where ? buildWhere(v.where) : {},
        { $set: mapValues(ValuesMode.Update, v.update, table) }
      );

      if (result.matchedCount > 0) return;
      await this.createMany(table, [v.create]);
    },
    async create(table, values) {
      const collection = client.collection(table._.name);
      const { insertedId } = await collection.insertOne(
        mapValues(ValuesMode.Insert, values, table)
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
        .insertMany(values.map((v) => mapValues(ValuesMode.Insert, v, table)));
    },
    async deleteMany(table, v) {
      const where = v.where ? buildWhere(v.where) : {};

      await client.collection(table._.name).deleteMany(where);
    },
  };
}
