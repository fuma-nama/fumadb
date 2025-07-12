import { createTables, ORMAdapter, SimplifyFindOptions } from "./base";
import { Binary, Db, Document, Filter, ObjectId } from "mongodb";
import { AnySelectClause, AbstractColumn, FindManyOptions } from "..";
import { AnySchema, AnyTable, Column } from "../../schema";
import { Condition, ConditionType, Operator } from "../condition-builder";

export type MongoDBClient = Db;

function buildWhere(condition: Condition): Filter<Document> {
  function doc(name: string, op: Operator, value: unknown): Filter<Document> {
    switch (op) {
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
        throw new Error(`Unsupported operator: ${op}`);
    }
  }

  function expr(exp1: string, op: Operator, exp2: string): Filter<Document> {
    switch (op) {
      case "=":
      case "is":
        return { $eq: [exp1, exp2] };
      case "!=":
      case "<>":
      case "is not":
        return { $ne: [exp1, exp2] };
      case ">":
        return { $gt: [exp1, exp2] };
      case ">=":
        return { $gte: [exp1, exp2] };
      case "<":
        return { $lt: [exp1, exp2] };
      case "<=":
        return { $lte: [exp1, exp2] };
      case "in":
        return { $in: [exp1, exp2] };
      case "not in":
        return { $nin: [exp1, exp2] };
      case "starts with":
        return {
          $regexMatch: {
            input: exp1,
            regex: `^${exp2}`,
            options: "i",
          },
        };
      case "not starts with":
        return {
          $not: [expr(exp1, "starts with", exp2)],
        };
      case "contains":
        return {
          $regexMatch: {
            input: exp1,
            regex: exp2,
            options: "i",
          },
        };
      case "not contains":
        return {
          $not: [expr(exp1, "contains", exp2)],
        };
      case "ends with":
        return {
          $regexMatch: {
            input: exp1,
            regex: `${exp2}$`,
            options: "i",
          },
        };
      case "not ends with":
        return {
          $not: [expr(exp1, "ends with", exp2)],
        };
      default:
        throw new Error(`Unsupported operator: ${op}`);
    }
  }

  if (condition.type == ConditionType.Compare) {
    const column = condition.a;
    let value = condition.b;
    const name = column.raw.getMongoDBName();
    if (value instanceof Column) {
      return {
        $match: expr(
          `$${name}`,
          condition.operator,
          column.raw._table === value._table
            ? `$${value.ormName}`
            : `$$${value._table!.ormName}_${value.ormName}`
        ),
      };
    }

    return doc(name, condition.operator, value);
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

function mapProjection(select: AnySelectClause, table: AnyTable): Document {
  const out: Document = {
    _id: 0,
  };

  for (const k of Array.isArray(select) ? select : Object.keys(table.columns)) {
    const col = table.columns[k];
    out[k] = col ? `$${col.getMongoDBName()}` : 1;
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
  table: AnyTable
) {
  const out: Record<string, unknown> = {};
  for (const k in table.columns) {
    if (mode === ValuesMode.Update && values[k] === undefined) continue;
    const value = values[k] ?? null;
    const name = table.columns[k]!.getMongoDBName();

    if (value instanceof Uint8Array) {
      out[name] = new Binary(value);
      continue;
    }

    out[name] = value;
  }

  return out;
}

function mapResult(
  result: Record<string, unknown>,
  table: AnyTable
): Record<string, unknown> {
  for (const k in result) {
    const value = result[k];

    if (!(k in table.columns) && k in table.relations && value) {
      result[k] = mapResult(value as any, table.relations[k]!.table);
      continue;
    }

    if (value instanceof ObjectId) {
      result[k] = value.toString("hex");
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

  // temporary solution to database migration
  let inited = false;
  async function init() {
    if (inited) return;
    inited = true;

    async function initTable(table: AnyTable) {
      const collection = await client.createCollection(table.ormName);
      const columns = Object.values(table.columns);
      const indexes = await collection.indexes();
      const create = [];

      for (const index of indexes) {
        if (!index.name || "_id" in index.key) continue;
        const isUniqueIndex = columns.some((col) => {
          return col.unique && index.key[col.getMongoDBName()] === 1;
        });

        if (!isUniqueIndex) {
          await collection.dropIndex(index.name);
        }
      }

      for (const column of columns) {
        if (!column.unique) continue;
        create.push({ key: { [column.ormName]: 1 }, name: column.ormName });
      }

      if (create.length > 0)
        await collection.createIndexes(create, { unique: true });
    }

    await Promise.all(Object.values(schema.tables).map(initTable));
  }

  function buildFindPipeline(
    table: AnyTable,
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

        for (const [key, col] of Object.entries(table.columns)) {
          vars[`${table.ormName}_${key}`] = `$${col.getMongoDBName()}`;
        }

        const targetTable = relation.table;
        pipeline.push({
          $lookup: {
            from: targetTable.ormName,
            let: vars,
            pipeline: [
              ...relation.on.map(([left, right]) => {
                return {
                  $match: {
                    $expr: {
                      $eq: [
                        `$${targetTable.columns[right]!.getMongoDBName()}`,
                        `$$${table.ormName}_${left}`,
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
      await init();

      return await client
        .collection(table._.name)
        .countDocuments(where ? buildWhere(where) : undefined);
    },
    async findFirst(from, v) {
      await init();
      const result = await this.findMany(from, {
        ...v,
        limit: 1,
      });

      return result[0] ?? null;
    },
    async findMany(from, v) {
      await init();
      const query = client
        .collection(from._.name)
        .aggregate(buildFindPipeline(from._.raw, v));
      const result = await query.toArray();
      return result.map((v) => mapResult(v, from._.raw));
    },
    async updateMany(from, v) {
      await init();
      const where = v.where ? buildWhere(v.where) : {};

      await client.collection(from._.name).updateMany(where, {
        $set: mapValues(ValuesMode.Update, v.set, from._.raw),
      });
    },
    async upsert(table, v) {
      await init();
      const collection = client.collection(table._.name);

      const result = await collection.updateOne(
        v.where ? buildWhere(v.where) : {},
        { $set: mapValues(ValuesMode.Update, v.update, table._.raw) }
      );

      if (result.matchedCount > 0) return;
      await this.createMany(table, [v.create]);
    },
    async create(table, values) {
      await init();
      const collection = client.collection(table._.name);
      const { insertedId } = await collection.insertOne(
        mapValues(ValuesMode.Insert, values, table._.raw)
      );

      const result = await collection.findOne(
        {
          _id: insertedId,
        },
        {
          projection: mapProjection(true, table._.raw),
        }
      );

      if (result === null)
        throw new Error(
          "Failed to insert document: cannot find inserted coument."
        );
      return mapResult(result, table._.raw);
    },
    async createMany(table, values) {
      await init();
      await client
        .collection(table._.name)
        .insertMany(
          values.map((v) => mapValues(ValuesMode.Insert, v, table._.raw))
        );
    },
    async deleteMany(table, v) {
      await init();
      const where = v.where ? buildWhere(v.where) : {};

      await client.collection(table._.name).deleteMany(where);
    },
  };
}
