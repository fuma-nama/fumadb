import Database from "better-sqlite3";
import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect } from "kysely";
import { MongoClient } from "mongodb";
import { createPool } from "mysql2";
import { Pool } from "pg";

export const kyselyTests = [
  {
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: new Pool({
          database: "postgresql",
          host: "localhost",
          user: "user",
          password: "password",
          port: 5434,
          max: 10,
        }),
      }),
    }),
    provider: "postgresql" as const,
  },
  {
    provider: "mysql" as const,
    db: new Kysely({
      dialect: new MysqlDialect({
        pool: createPool({
          database: "mysql",
          host: "localhost",
          user: "root",
          password: "password",
          port: 3308,
          connectionLimit: 10,
        }),
      }),
    }),
  },
  {
    provider: "sqlite" as const,
    db: new Kysely({
      dialect: new SqliteDialect({
        database: new Database(":memory:"),
      }),
    }),
  },
];

export const mongodb = new MongoClient(
  "mongodb://root:password@localhost:27017"
);
