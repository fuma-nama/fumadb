import type { MongoClient } from "mongodb";
import { FumaDBAdapter } from "../";
import { fromMongoDB } from "./query";
import { AbstractQuery } from "../../query";

export interface MongoDBConfig {
  client: MongoClient;
}

export function mongoAdapter(options: MongoDBConfig): FumaDBAdapter {
  return {
    createORM(schema) {
      return fromMongoDB(schema, options.client) as AbstractQuery<any>;
    },
  };
}
