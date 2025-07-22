import {
  createSoftForeignKey,
  createTables,
  SimplifyFindOptions,
  toORM,
} from "./base";
import {
  Binary,
  MongoClient,
  Document,
  Filter,
  ObjectId,
  ClientSession,
} from "mongodb";
import {
  AnySelectClause,
  AbstractColumn,
  FindManyOptions,
  AbstractQuery,
} from "..";
import { AnySchema, AnyTable, Column } from "../../schema";
import { Condition, ConditionType, Operator } from "../condition-builder";
import { createId } from "fumadb/cuid";

const dataTypes = [
  "double",
  "string",
  "object",
  "array",
  "binData",
  "undefined",
  "objectId",
  "bool",
  "date",
  "null",
  "regex",
  "dbPointer",
  "javascript",
  "symbol",
  "int",
  "timestamp",
  "long",
  "decimal",
  "minKey",
  "maxKey",
] as const;

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
    const name = col.raw.getMongoDBName();

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
    const col = table.columns[k]!;
    const name = col.getMongoDBName();
    let value = values[k];

    if (value === undefined && col.default === "auto") {
      value = createId();
    } else if (value instanceof Uint8Array) {
      value = new Binary(value);
    }

    // use null otherwise the field will be missing
    out[name] = value ?? null;
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
/**
 * This adapter uses string ids instead of object id, which is better suited for the API design of FumaDB.
 */
export function fromMongoDB(
  schema: AnySchema,
  client: MongoClient,
  session?: ClientSession
): AbstractQuery<AnySchema> {
  const abstractTables = createTables(schema);
  const db = client.db();

  // temporary solution to database migration
  let inited = false;
  async function init() {
    if (inited) return;
    inited = true;
    // transaction instances do not need initialization
    if (session) return;

    async function initTable(table: AnyTable) {
      const collection = await db.createCollection(table.ormName);
      const columns = Object.values(table.columns);
      const indexes = await collection.indexes();

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
        await collection.createIndex(
          {
            [column.ormName]: 1,
          },
          {
            unique: true,
            // ignore null values to align with SQL databases
            partialFilterExpression: {
              $or: dataTypes.flatMap<object>((dataType) =>
                dataType !== "null"
                  ? {
                      [column.ormName]: { $type: dataType },
                    }
                  : []
              ),
            },
          }
        );
      }
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
            $set: {
              [relation.ormName]: {
                $ifNull: [{ $first: `$${relation.ormName}` }, null],
              },
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

  const orm = createSoftForeignKey(schema, {
    tables: abstractTables,
    async count(table, { where }) {
      await init();

      return await db
        .collection(table._.name)
        .countDocuments(where ? buildWhere(where) : undefined, { session });
    },
    async findFirst(from, v) {
      await init();
      const result = await orm.findMany(from, {
        ...v,
        limit: 1,
      });

      return result[0] ?? null;
    },
    async findMany(from, v) {
      await init();
      const query = db
        .collection(from._.name)
        .aggregate(buildFindPipeline(from._.raw, v), { session });
      const result = await query.toArray();
      return result.map((v) => mapResult(v, from._.raw));
    },
    async updateMany(from, v) {
      await init();
      const where = v.where ? buildWhere(v.where) : {};

      await db.collection(from._.name).updateMany(
        where,
        {
          $set: mapValues(ValuesMode.Update, v.set, from._.raw),
        },
        {
          session,
        }
      );
    },
    async create(table, values) {
      await init();
      const collection = db.collection(table._.name);
      const { insertedId } = await collection.insertOne(
        mapValues(ValuesMode.Insert, values, table._.raw),
        { session }
      );

      const result = await collection.findOne(
        {
          _id: insertedId,
        },
        {
          session,
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
      const rawTable = table._.raw;
      const idColumn = rawTable.getIdColumn();
      const encodedValues = values.map((v) =>
        mapValues(ValuesMode.Insert, v, rawTable)
      );
      await db.collection(table._.name).insertMany(encodedValues, { session });
      return encodedValues.map((value) => ({ _id: value[idColumn.ormName] }));
    },
    async deleteMany(table, v) {
      await init();
      const where = v.where ? buildWhere(v.where) : undefined;

      await db.collection(table._.name).deleteMany(where, { session });
    },
    async transaction(run) {
      const child = client.startSession();

      try {
        return await child.withTransaction(
          () => run(fromMongoDB(schema, client, child)),
          {
            session,
          }
        );
      } finally {
        await child.endSession();
      }
    },
  });

  return toORM(orm);
}
