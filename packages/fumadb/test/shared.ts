import Database from "better-sqlite3";
import {
  Kysely,
  PostgresDialect,
  MysqlDialect,
  SqliteDialect,
  sql,
} from "kysely";
import { MongoClient } from "mongodb";
import { createPool } from "mysql2";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import { x } from "tinyexec";
import { generateSchema } from "../src/schema/generate";
import { Provider } from "../src";
import { Schema } from "../src/schema";

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

const connectionStrings = [
  {
    provider: "postgresql" as const,
    url: `postgresql://${postgres.user}:${postgres.password}@${postgres.host}:${postgres.port}/${postgres.database}`,
  },
  {
    provider: "mysql" as const,
    url: `mysql://${mysql.user}:${mysql.password}@${mysql.host}:${mysql.port}/${mysql.database}`,
  },
  {
    provider: "sqlite" as const,
    url: "file:" + sqlite,
  },
  {
    provider: "mongodb" as const,
    url: "mongodb://localhost:27017/test?replicaSet=rs0&directConnection=true",
  },
];

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
  connectionStrings.find((str) => str.provider === "mongodb")!.url
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

export const prismaTests = [
  {
    provider: "postgresql" as const,
    db: async (schema: Schema) => initPrismaClient(schema, "postgresql"),
  },
  {
    provider: "mysql" as const,
    db: async (schema: Schema) => initPrismaClient(schema, "mysql"),
  },
  {
    provider: "sqlite" as const,
    db: async (schema: Schema) => initPrismaClient(schema, "sqlite"),
  },
  {
    provider: "mongodb" as const,
    db: async (schema: Schema) => initPrismaClient(schema, "mongodb"),
  },
];

const prismaDir = path.join(__dirname, "../node_modules/_prisma");
async function initPrismaClient(schema: Schema, provider: Provider) {
  fs.mkdirSync(prismaDir, { recursive: true });
  const schemaPath = path.join(
    prismaDir,
    `schema.${schema.version}.${provider}.prisma`
  );
  const url = connectionStrings.find((str) => str.provider === provider)!.url;
  const clientPath = path.join(
    prismaDir,
    `client-${schema.version}-${provider}`
  );

  const schemaCode =
    generateSchema(schema, {
      type: "prisma",
      provider,
    }) +
    `\ndatasource db {
  provider = "${provider}"
  url      = "${url}"
}

generator client {
  provider = "prisma-client-js"
  output   = "${clientPath}"
}`;

  fs.writeFileSync(schemaPath, schemaCode);

  // Push schema to database
  await x(
    "npx",
    [
      "prisma",
      "db",
      "push",
      `--schema=${schemaPath}`,
      "--force-reset",
      "--accept-data-loss",
    ],
    {
      nodeOptions: {
        cwd: path.dirname(__dirname),
      },
    }
  ).then((res) => console.log(res.stdout));

  const { PrismaClient } = await import(clientPath + "/index.js");

  return new PrismaClient();
}

// Helper function to cleanup generated Prisma files
export const cleanupPrismaFiles = () => {
  if (fs.existsSync(prismaDir))
    fs.rmSync(prismaDir, { recursive: true, force: true });
};

export async function resetDB(provider: Provider, dbName: string = "test") {
  if (provider === "mongodb") {
    await mongodb.db(dbName).dropDatabase();
    return;
  }

  const kysely = kyselyTests.find((kysely) => kysely.provider === provider)!;
  const db = kysely.db as Kysely<any>;

  if (provider === "mysql") {
    const tables = await db
      .selectFrom("information_schema.tables")
      .select("TABLE_NAME")
      .where((b) =>
        b.or([
          b("TABLE_SCHEMA", "not in", [
            "mysql",
            "performance_schema",
            "information_schema",
            "sys",
          ]),
          b("TABLE_NAME", "=", "__drizzle_migrations"),
        ])
      )
      .where("TABLE_TYPE", "=", "BASE TABLE")
      .execute();

    await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
    await Promise.all(
      tables.map((table) =>
        db.schema.dropTable(table.TABLE_NAME).ifExists().execute()
      )
    );
    await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
    return;
  }

  if (provider === "sqlite") {
    const tables = await db
      .selectFrom("sqlite_master")
      .select("name")
      .where("type", "=", "table")
      .where("name", "not like", "sqlite_%")
      .execute();

    await sql`PRAGMA foreign_keys = OFF`.execute(db);
    await Promise.all(
      tables.map((table) =>
        db.schema.dropTable(table.name).ifExists().execute()
      )
    );
    await sql`PRAGMA foreign_keys = ON`.execute(db);
    return;
  }

  if (provider === "postgresql") {
    const tables = await db
      .selectFrom("information_schema.tables")
      .select(["table_schema", "table_name"])
      .where("table_type", "=", "BASE TABLE")
      .where("table_schema", "not in", ["pg_catalog", "information_schema"])
      .execute();

    await Promise.all(
      tables.map((t) =>
        db.schema
          .dropTable(`${t.table_schema}.${t.table_name}`)
          .ifExists()
          .cascade()
          .execute()
      )
    );
    return;
  }

  if (provider === "mssql") {
    const tables = await db
      .selectFrom("information_schema.tables")
      .select(["table_schema", "table_name"])
      .where("table_type", "=", "BASE TABLE")
      .where("table_schema", "not in", ["sys", "INFORMATION_SCHEMA"])
      .execute();

    await Promise.all(
      tables.map(async (t) => {
        const table = `${t.table_schema}.${t.table_name}`;
        await sql`EXEC dbo.DropFKConstraintsReferencingTable ${table}`.execute(
          db
        );

        await db.schema.dropTable(table).ifExists().execute();
      })
    );
    return;
  }

  const tables = await db
    .selectFrom("information_schema.tables")
    .select(["table_schema", "table_name"])
    .where("table_type", "=", "BASE TABLE")
    .where("table_schema", "not in", [
      "crdb_internal",
      "pg_catalog",
      "information_schema",
      "public",
    ])
    .execute();

  await Promise.all(
    tables.map((t) =>
      db.schema
        .dropTable(`${t.table_schema}.${t.table_name}`)
        .ifExists()
        .execute()
    )
  );
}
