import type { MongoClient } from "mongodb";
import type { FumaDBAdapter } from "../";
import { fromMongoDB } from "./query";
import { createMigrator, type Migrator } from "../../migration-engine/create";
import type { LibraryConfig } from "../../shared/config";
import { execute } from "../../migration-engine/mongodb/execute";

export interface MongoDBConfig {
  client: MongoClient;
}

export function mongoAdapter(options: MongoDBConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromMongoDB(schema, options.client);
    },
    createMigrationEngine() {
      return createMongoDBMigrator(this, options.client);
    },
    getSchemaVersion() {
      const manager = createSettingsManager(this, options.client);
      return manager.getSchemaVersion();
    },
  };
}

function createMongoDBMigrator(
  lib: LibraryConfig,
  client: MongoClient
): Migrator {
  const manager = createSettingsManager(lib, client);

  return createMigrator({
    ...lib,
    libConfig: lib,
    userConfig: {
      provider: "mongodb",
    },
    settings: {
      getVersion() {
        return manager.getSchemaVersion();
      },
      updateVersionInMigration(version) {
        return [
          {
            type: "custom",
            setVersion: version,
          },
        ];
      },
    },
    async executor(operations) {
      const session = client.startSession();

      try {
        for (const op of operations) {
          await execute(op, { client, session }, (node) =>
            manager.setSchemaVersion(node.setVersion as string)
          ).catch((e) => {
            console.error("failed at", op, e);
            throw e;
          });
        }
      } finally {
        await session.endSession();
      }
    },
  });
}

function createSettingsManager(lib: LibraryConfig, client: MongoClient) {
  const db = client.db();
  const collection = db.collection<{
    version: string;
  }>(`private_${lib.namespace}_version`);

  return {
    async getSchemaVersion() {
      const result = await collection.findOne();
      return result?.version;
    },
    async setSchemaVersion(version: string) {
      const result = await collection.updateOne({}, { $set: { version } });

      if (result.matchedCount === 0) {
        await collection.insertOne({ version });
      }
    },
  };
}
