import {
  type MongoClient,
  type ClientSession,
  type Collection,
  type Document,
  Binary,
  ObjectId,
} from "mongodb";
import type { MigrationOperation, ColumnOperation } from "../shared";
import { AnyColumn, AnyTable, IdColumn, TypeMap } from "../../schema/create";
import {
  bigintToUint8Array,
  booleanToUint8Array,
  numberToUint8Array,
  stringToUint8Array,
  uint8ArrayToBigInt,
  uint8ArrayToBoolean,
  uint8ArrayToNumber,
  uint8ArrayToString,
} from "../../utils/binary";

interface MongoDBConfig {
  client: MongoClient;
  session?: ClientSession;
}

const errors = {
  IdColumnUpdate:
    "ID columns must not be updated, not every database supports updating primary keys and often requires workarounds.",
};

async function createUniqueIndex(
  collection: Collection<Document>,
  col: AnyColumn
) {
  await collection.createIndex(
    { [col.names.mongodb]: 1 },
    {
      unique: true,
      sparse: true,
    }
  );
}

async function dropUniqueIndex(
  collection: Collection<Document>,
  colName: string
) {
  if (colName === "_id") return;
  const indexes = await collection.indexes();

  for (const index of indexes) {
    if (!index.name || !index.unique || index.key[colName] !== 1) continue;

    await collection.dropIndex(index.name);
    break;
  }
}

async function executeColumn(
  collection: Collection<Document>,
  operation: ColumnOperation,
  config: MongoDBConfig
) {
  const { session } = config;

  switch (operation.type) {
    case "rename-column":
      await collection.updateMany(
        {},
        { $rename: { [operation.from]: operation.to } },
        { session }
      );
      return;

    case "drop-column":
      await dropUniqueIndex(collection, operation.name);

      await collection.updateMany(
        {},
        { $unset: { [operation.name]: "" } },
        { session }
      );
      return;
    case "create-column": {
      const col = operation.value;
      const defaultValue = col.generateDefaultValue() ?? null;

      if (defaultValue) {
        await collection.updateMany(
          { [col.names.mongodb]: { $exists: false } },
          { $set: { [col.names.mongodb]: defaultValue } },
          { session }
        );
      }

      if (col.unique) {
        await createUniqueIndex(collection, col);
      }
      return;
    }

    // do not handle nullable & default update as they're handled at application level
    case "update-column":
      const col = operation.value;

      if (col instanceof IdColumn) {
        throw new Error(errors.IdColumnUpdate);
      }

      if (operation.updateDataType) {
        const field = operation.name;
        const bulk = collection.initializeUnorderedBulkOp();

        for await (const doc of collection.find()) {
          bulk.find({ _id: doc._id }).updateOne({
            $set: { [field]: migrateDataType(doc[field], col.type) },
          });
        }

        if (bulk.batches.length > 0) await bulk.execute();
      }

      if (operation.updateUnique) {
        if (col.unique) await createUniqueIndex(collection, col);
        else await dropUniqueIndex(collection, col.names.mongodb);
      }
  }
}

export async function execute(
  operation: MigrationOperation,
  config: MongoDBConfig
): Promise<boolean> {
  const { client, session } = config;
  const db = client.db();

  async function createCollection(table: AnyTable) {
    const collection = await db.createCollection(table.names.mongodb);

    // init unique index, columns are created on insert
    for (const col of Object.values(table.columns)) {
      if (!col.unique) continue;
      await createUniqueIndex(collection, col);
    }
  }

  switch (operation.type) {
    case "create-table":
      await createCollection(operation.value);
      return true;

    case "rename-table":
      await db.collection(operation.from).rename(operation.to, { session });
      return true;

    case "update-table":
      const collection = db.collection(operation.name);

      for (const op of operation.value) {
        await executeColumn(collection, op, config);
      }

      return true;

    case "drop-table":
      await db.collection(operation.name).drop({ session });
      return true;

    case "kysely-builder":
      throw new Error(
        "Kysely builder operations are not supported for MongoDB"
      );

    case "sql":
      throw new Error("SQL operations are not supported for MongoDB");

    case "recreate-table":
      throw new Error("`recreate-table` is for SQLite only");

    case "add-foreign-key":
    case "drop-foreign-key":
      // MongoDB doesn't have foreign key constraints
      // This would be handled at the application level
      return false;
  }
}

function migrateDataType(originalValue: unknown, toType: keyof TypeMap) {
  // ignore string constraint
  if (toType.startsWith("varchar(")) toType = "string";

  // just for safe, generally you can't migrate the data type of id column
  if (originalValue instanceof ObjectId)
    originalValue = originalValue.toHexString();

  if (originalValue == null) return originalValue;

  if (toType === "bigint") {
    if (originalValue instanceof Binary) {
      return uint8ArrayToBigInt(originalValue.buffer);
    }

    if (originalValue instanceof Date) return BigInt(originalValue.getTime());

    switch (typeof originalValue) {
      case "bigint":
        return originalValue;
      case "boolean":
        return originalValue ? 1n : 0n;
      case "number":
      case "string":
        return BigInt(originalValue);
      default:
        throw new Error(`Failed to convert ${originalValue} to ${toType}.`);
    }
  }

  if (toType === "bool") {
    if (originalValue instanceof Binary) {
      return uint8ArrayToBoolean(originalValue.buffer);
    }

    switch (typeof originalValue) {
      case "boolean":
        return originalValue;
      case "bigint":
        return originalValue !== 0n;
      case "number":
        return originalValue !== 0;
      case "string":
        return originalValue.toLowerCase() === "true";
      default:
        throw new Error(`Failed to convert ${originalValue} to ${toType}.`);
    }
  }

  if (toType === "binary") {
    if (originalValue instanceof Binary) return originalValue;
    if (originalValue instanceof Date) originalValue = originalValue.getTime();

    switch (typeof originalValue) {
      case "bigint":
        return new Binary(bigintToUint8Array(originalValue));
      case "string":
        return new Binary(stringToUint8Array(originalValue));
      case "number":
        return new Binary(numberToUint8Array(originalValue));
      case "boolean":
        return new Binary(booleanToUint8Array(originalValue));
      default:
        throw new Error(`Failed to convert ${originalValue} to ${toType}.`);
    }
  }

  if (toType === "date" || toType === "timestamp") {
    if (originalValue instanceof Binary)
      return new Date(uint8ArrayToNumber(originalValue.buffer));
    if (originalValue instanceof Date) return originalValue;

    switch (typeof originalValue) {
      case "bigint":
        // ignore precision loss, we assume bigint when used as time, won't exceed the safe integer range.
        return new Date(Number(originalValue));
      case "string":
      case "number":
        return new Date(originalValue);
      default:
        throw new Error(`Failed to convert ${originalValue} to ${toType}.`);
    }
  }

  if (toType === "decimal" || toType === "integer") {
    if (originalValue instanceof Binary)
      return uint8ArrayToNumber(originalValue.buffer);
    if (originalValue instanceof Date) return originalValue.getTime();

    switch (typeof originalValue) {
      case "bigint":
      case "string":
      case "number":
        return Number(originalValue);
      case "boolean":
        return originalValue ? 1 : 0;
      default:
        throw new Error(`Failed to convert ${originalValue} to ${toType}.`);
    }
  }

  // MongoDB can just store JSON-compatible values, not conversion needed
  if (toType === "json") return originalValue;

  if (toType === "string") {
    if (originalValue instanceof Binary)
      return uint8ArrayToString(originalValue.buffer);

    switch (typeof originalValue) {
      case "bigint":
      case "boolean":
      case "number":
      case "string":
        return String(originalValue);
      default:
        return JSON.stringify(originalValue);
    }
  }
}
