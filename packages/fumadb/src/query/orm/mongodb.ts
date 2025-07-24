import { createTables, SimplifyFindOptions, toORM } from "./base";
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
import { AnyColumn, AnySchema, AnyTable, Column } from "../../schema";
import { Condition, ConditionType, Operator } from "../condition-builder";
import { createId } from "fumadb/cuid";
import { createSoftForeignKey } from "../polyfills/foreign-key";

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
    const column = condition.a.raw;
    let value = condition.b;

    const name = column.names.mongodb;
    if (value instanceof Column) {
      return {
        $match: expr(
          `$${name}`,
          condition.operator,
          column._table === value._table
            ? `$${value.names.mongodb}`
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

  if (select === true) {
    for (const col of Object.values(table.columns)) {
      out[col.ormName] = `$${col.names.mongodb}`;
    }
  } else {
    for (const k of select) {
      const col = table.columns[k];
      if (!col) continue;

      out[k] = `$${col.names.mongodb}`;
    }
  }

  return out;
}

function mapSort(orderBy: [column: AbstractColumn, "asc" | "desc"][]) {
  const out: Record<string, 1 | -1> = {};

  for (const [col, mode] of orderBy) {
    out[col.raw.names.mongodb] = mode === "asc" ? 1 : -1;
  }

  return out;
}

function mapValues(values: Record<string, unknown>, table: AnyTable) {
  const out: Record<string, unknown> = {};

  for (const k in table.columns) {
    const col = table.columns[k];
    let value = values[k];

    if (value instanceof Uint8Array) {
      value = new Binary(value);
    }

    if (value !== undefined) out[col.names.mongodb] = value;
  }

  return out;
}

function mapResult(
  result: Record<string, unknown>,
  table: AnyTable
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const k in result) {
    let value = result[k];

    if (k in table.relations) {
      const relation = table.relations[k];

      if (Array.isArray(value)) {
        value = value.map((v) => mapResult(v, relation.table));
      } else if (value) {
        value = mapResult(value as any, relation.table);
      }

      out[k] = value;
      continue;
    }

    if (value instanceof ObjectId) {
      value = value.toString("hex");
    } else if (value instanceof Binary) {
      const buffer = value.buffer;
      value =
        buffer instanceof Buffer
          ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
          : buffer;
    }

    out[k] = value;
  }

  return out;
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
      const collection = await db.createCollection(table.names.mongodb);
      const columns = Object.values(table.columns);
      const indexes = await collection.indexes();

      for (const index of indexes) {
        if (!index.name || "_id" in index.key) continue;
        const isUniqueIndex = columns.some((col) => {
          return col.unique && index.key[col.names.mongodb] === 1;
        });

        if (!isUniqueIndex) {
          await collection.dropIndex(index.name);
        }
      }

      for (const column of columns) {
        if (!column.unique) continue;
        await collection.createIndex(
          {
            [column.names.mongodb]: 1,
          },
          {
            unique: true,
            // ignore null values to align with SQL databases
            partialFilterExpression: {
              $or: dataTypes.flatMap<object>((dataType) =>
                dataType !== "null"
                  ? {
                      [column.names.mongodb]: { $type: dataType },
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
        project[relation.name] = 1;

        if (joinOptions === false) continue;
        const vars: Record<string, string> = {};

        for (const column of Object.values(table.columns)) {
          vars[`${table.ormName}_${column.ormName}`] =
            `$${column.names.mongodb}`;
        }

        const targetTable = relation.table;
        pipeline.push({
          $lookup: {
            from: targetTable.names.mongodb,
            let: vars,
            pipeline: [
              ...relation.on.map(([left, right]) => {
                return {
                  $match: {
                    $expr: {
                      $eq: [
                        `$${targetTable.columns[right].names.mongodb}`,
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
            as: relation.name,
          },
        });

        if (relation.type === "one") {
          pipeline.push({
            $set: {
              [relation.name]: {
                $ifNull: [{ $first: `$${relation.name}` }, null],
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
    generateInsertValuesDefault(table, values) {
      const out: Record<string, unknown> = {};

      // fallback to null otherwise the field will be missing
      function generateDefaultValue(col: AnyColumn) {
        if (!col.default) return null;

        if (col.default === "auto") {
          return createId();
        }

        if (col.default === "now") {
          return new Date(Date.now());
        }

        if ("value" in col.default) {
          return col.default.value;
        }

        return null;
      }

      for (const k in table.columns) {
        if (values[k] === undefined) {
          out[k] = generateDefaultValue(table.columns[k]);
        } else {
          out[k] = values[k];
        }
      }

      return out;
    },
    tables: abstractTables,
    async count({ _: { raw } }, { where }) {
      await init();

      return await db
        .collection(raw.names.mongodb)
        .countDocuments(where ? buildWhere(where) : undefined, { session });
    },
    async findFirst(table, v) {
      await init();
      const result = await orm.findMany(table, {
        ...v,
        limit: 1,
      });

      return result[0] ?? null;
    },
    async findMany({ _: { raw } }, v) {
      await init();
      const query = db
        .collection(raw.names.mongodb)
        .aggregate(buildFindPipeline(raw, v), { session });

      const result = await query.toArray();
      return result.map((v) => mapResult(v, raw));
    },
    async updateMany({ _: { raw } }, v) {
      await init();
      const where = v.where ? buildWhere(v.where) : {};

      await db.collection(raw.names.mongodb).updateMany(
        where,
        {
          $set: mapValues(v.set, raw),
        },
        {
          session,
        }
      );
    },
    async create({ _: { raw } }, values) {
      await init();
      const collection = db.collection(raw.names.mongodb);
      const { insertedId } = await collection.insertOne(
        mapValues(values, raw),
        { session }
      );

      const result = await collection.findOne(
        {
          _id: insertedId,
        },
        {
          session,
          projection: mapProjection(true, raw),
        }
      );

      if (result === null)
        throw new Error(
          "Failed to insert document: cannot find inserted coument."
        );
      return mapResult(result, raw);
    },
    async createMany({ _: { raw } }, values) {
      await init();
      const idField = raw.getIdColumn().names.mongodb;
      values = values.map((v) => mapValues(v, raw));

      await db.collection(raw.names.mongodb).insertMany(values, { session });
      return values.map((value) => ({ _id: value[idField] }));
    },
    async deleteMany({ _: { raw } }, v) {
      await init();
      const where = v.where ? buildWhere(v.where) : undefined;

      await db.collection(raw.names.mongodb).deleteMany(where, { session });
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
