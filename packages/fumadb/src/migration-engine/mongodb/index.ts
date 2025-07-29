import type { LibraryConfig } from "../../shared/config";
import { getInternalTables } from "../../migration-engine/shared";
import { VersionManager } from "../create";
import { execute } from "./execute";
import { createMigrator, Migrator } from "../create";
import { MongoClient } from "mongodb";

export function createMongoDBMigrator(
  lib: LibraryConfig,
  client: MongoClient
): Migrator {
  return createMigrator({
    ...lib,
    createVersionManager: () => createVersionManager(lib, client),
    async executor(operations) {
      const session = client.startSession();

      try {
        for (const op of operations) {
          await execute(op, { client, session }).catch((e) => {
            console.error("failed at", op, e);
            throw e;
          });
        }
      } finally {
        await session.endSession();
      }
    },
    provider: "mongodb",
  });
}

function createVersionManager(
  lib: LibraryConfig,
  client: MongoClient
): VersionManager {
  const db = client.db();
  const { initialVersion = "0.0.0" } = lib;
  const { versions } = getInternalTables(lib.namespace);
  const collection = db.collection<{
    version: string;
  }>(versions);

  return {
    async get() {
      const result = await collection.findOne();
      return result?.version ?? initialVersion;
    },
    async set(version) {
      const result = await collection.updateOne({}, { $set: { version } });

      if (result.matchedCount === 0) {
        await collection.insertOne({ version });
      }
    },
  };
}
