import type { MongoClient } from "mongodb";
import type { FumaDBAdapter } from "../";
import { fromMongoDB } from "./query";
import { createMongoDBMigrator } from "../../migration-engine/mongodb";

export interface MongoDBConfig {
  client: MongoClient;
}

export function mongoAdapter(options: MongoDBConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromMongoDB(schema, options.client);
    },
    createMigrationEngine(lib) {
      return createMongoDBMigrator(lib, options.client);
    },
  };
}
