import Database from "better-sqlite3";
import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect } from "kysely";
import { MongoClient } from "mongodb";
import { createPool } from "mysql2";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as path from "node:path";

export const postgres = {
  database: "postgresql",
  host: "localhost",
  user: "user",
  password: "password",
  port: 5434,
  max: 10,
};

export const mysql = {
  database: "test",
  host: "localhost",
  user: "root",
  password: "password",
  port: 3308,
  connectionLimit: 10,
};

export const sqlite = path.join(__dirname, "./sqlite.sqlite");

export const kyselyTests = [
  {
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: new Pool(postgres),
      }),
    }),
    provider: "postgresql" as const,
  },
  {
    provider: "mysql" as const,
    db: new Kysely({
      dialect: new MysqlDialect({
        pool: createPool(mysql),
      }),
    }),
  },
  {
    provider: "sqlite" as const,
    db: new Kysely({
      dialect: new SqliteDialect({
        database: new Database(sqlite),
      }),
    }),
  },
];

export const mongodb = new MongoClient(
  "mongodb://root:password@localhost:27017"
);

export const drizzleTests = [
  {
    provider: "postgresql" as const,
    db: (schema) =>
      drizzle({
        client: new Pool(postgres),
        schema,
      }),
  },
  {
    provider: "mysql" as const,
    db: (schema) =>
      drizzleMysql({
        client: createPool(mysql),
        schema,
        mode: "default",
      }),
  },
  {
    provider: "sqlite" as const,
    db: (schema) =>
      drizzleSqlite({
        client: new Database(sqlite),
        schema,
      }),
  },
];
