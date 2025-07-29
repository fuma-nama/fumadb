import { ConvexHttpClient } from "convex/browser";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import {
  Kysely,
  PostgresDialect,
  MysqlDialect,
  SqliteDialect,
  sql,
  MssqlDialect,
} from "kysely";
import { MongoClient } from "mongodb";
import * as MySQL from "mysql2";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite } from "drizzle-orm/libsql";
import * as path from "node:path";
import * as fs from "node:fs";
import { x } from "tinyexec";
import { Provider, SQLProvider } from "../src";
import { Schema } from "../src/schema";
import * as Tedious from "tedious";
import * as Tarn from "tarn";

const sqlitePath = path.join(
  import.meta.dirname,
  "../node_modules/sqlite.sqlite"
);

function createDB<T extends string, Pool>(options: {
  provider: T;
  url: string;
  create: (url: string) => Pool;
}) {
  return {
    ...options,
    create(): Pool {
      return options.create(options.url);
    },
  };
}

export const databases = [
  createDB({
    provider: "postgresql",
    url: "postgresql://user:password@localhost:5434/postgresql",
    create(url) {
      return new Pool({
        connectionString: url,
      });
    },
  }),
  createDB({
    provider: "mysql",
    url: "mysql://root:password@localhost:3308/test",
    create(url) {
      return MySQL.createPool({
        uri: url,
        connectionLimit: 10,
      });
    },
  }),
  createDB({
    provider: "sqlite",
    url: "file:" + sqlitePath,
    create(url) {
      return createClient({
        url,
      });
    },
  }),
  createDB({
    provider: "mongodb",
    url: "mongodb://localhost:27017/test?replicaSet=rs0&directConnection=true",
    create(url) {
      return new MongoClient(url);
    },
  }),
  createDB({
    provider: "convex",
    url: "http://127.0.0.1:3210",
    create(url) {
      return new ConvexHttpClient(url);
    },
  }),
  createDB({
    provider: "mssql",
    url: "mssql://sa:Password1234!@localhost:1433",
    create() {
      return new Tedious.Connection({
        authentication: {
          options: {
            userName: "sa",
            password: "Password1234!",
          },
          type: "default",
        },
        options: {
          port: 1433,
          trustServerCertificate: true,
          encrypt: false,
        },
        server: "localhost",
      });
    },
  }),
  createDB({
    provider: "cockroachdb",
    url: "postgresql://root:password@localhost:26257/test?sslmode=disable",
    create(url) {
      return new Pool({
        connectionString: url,
      });
    },
  }),
];

export const kyselyTests = [
  {
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: databases.find((s) => s.provider === "postgresql")!.create(),
      }),
    }),
    provider: "postgresql" as const,
  },
  {
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: databases.find((s) => s.provider === "cockroachdb")!.create(),
      }),
    }),
    provider: "cockroachdb" as const,
  },
  {
    provider: "mysql" as const,
    db: new Kysely({
      dialect: new MysqlDialect({
        pool: databases.find((s) => s.provider === "mysql")!.create(),
      }),
    }),
  },
  {
    provider: "sqlite" as const,
    db: new Kysely({
      dialect: new SqliteDialect({
        database: new Database(sqlitePath),
      }),
    }),
  },
  {
    provider: "mssql" as const,
    db: new Kysely({
      dialect: new MssqlDialect({
        tarn: {
          ...Tarn,
          options: {
            max: 10,
            min: 0,
          },
        },

        tedious: {
          ...Tedious,
          connectionFactory: () =>
            databases.find((db) => db.provider === "mssql")!.create(),
        },
      }),
    }),
  },
];

export const drizzleTests = [
  {
    provider: "postgresql" as const,
    db: (schema) =>
      drizzle({
        client: databases.find((s) => s.provider === "postgresql")!.create(),
        schema,
      }),
  },
  {
    provider: "mysql" as const,
    db: (schema) =>
      drizzleMysql({
        client: databases.find((s) => s.provider === "mysql")!.create(),
        schema,
        mode: "default",
      }),
  },
  {
    provider: "sqlite" as const,
    db: (schema) =>
      drizzleSqlite({
        client: databases.find((s) => s.provider === "sqlite")!.create(),
        schema,
      }),
  },
];

export const prismaTests = [
  {
    provider: "postgresql" as const,
    init: async (schema: Schema) => initPrismaClient(schema, "postgresql"),
  },
  {
    provider: "cockroachdb" as const,
    init: async (schema: Schema) => initPrismaClient(schema, "cockroachdb"),
  },
  {
    provider: "mysql" as const,
    init: async (schema: Schema) => initPrismaClient(schema, "mysql"),
  },
  {
    provider: "sqlite" as const,
    init: async (schema: Schema) => initPrismaClient(schema, "sqlite"),
  },
  {
    provider: "mongodb" as const,
    init: async (schema: Schema) => initPrismaClient(schema, "mongodb"),
  },
];

const prismaDir = path.join(import.meta.dirname, "../node_modules/_prisma");
async function initPrismaClient(schema: Schema, provider: Provider) {
  fs.mkdirSync(prismaDir, { recursive: true });
  const schemaPath = path.join(
    prismaDir,
    `schema.${schema.version}.${provider}.prisma`
  );
  const url = databases.find((str) => str.provider === provider)!.url;
  const clientPath = path.join(
    prismaDir,
    `client-${schema.version}-${provider}`
  );

  const { generateSchema } = await import("../src/adapters/prisma/generate");

  const schemaCode =
    generateSchema(schema, provider) +
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
        cwd: path.dirname(import.meta.dirname),
      },
    }
  ).then((res) => console.log(res.stdout, res.stderr));

  const { PrismaClient } = await import(clientPath + "/index.js");

  return new PrismaClient();
}

export async function initDrizzleClient(
  schema: Schema,
  provider: Exclude<SQLProvider, "mssql" | "cockroachdb">
) {
  const DrizzleKit = await import("drizzle-kit/api");
  const { generateSchema } = await import("../src/adapters/drizzle/generate");

  const schemaPath = path.join(
    import.meta.dirname,
    `drizzle-schema.${provider}.ts`
  );
  const schemaCode = generateSchema(schema, provider);

  fs.writeFileSync(schemaPath, schemaCode);
  const drizzleSchema = await import(`${schemaPath}?hash=${Date.now()}`);
  const db = drizzleTests
    .find((t) => t.provider === provider)!
    .db(drizzleSchema);

  if (provider === "postgresql") {
    const { apply } = await DrizzleKit.pushSchema(drizzleSchema, db as any);
    await apply();
  } else if (provider === "mysql") {
    const { sql } = await import("drizzle-orm");
    const prev = await DrizzleKit.generateMySQLDrizzleJson({});
    const cur = await DrizzleKit.generateMySQLDrizzleJson(drizzleSchema);
    const statements = await DrizzleKit.generateMySQLMigration(prev, cur);

    for (const statement of statements) {
      await (db as any).execute(sql.raw(statement));
    }
  } else {
    // they need libsql
    const { apply } = await DrizzleKit.pushSQLiteSchema(
      drizzleSchema,
      db as any
    );
    await apply();
  }

  fs.rmSync(schemaPath);
  return db;
}

export const cleanupFiles = () => {
  fs.rmSync(sqlitePath);

  if (fs.existsSync(prismaDir))
    fs.rmSync(prismaDir, { recursive: true, force: true });
};

export async function resetMongoDB(mongodb: MongoClient) {
  await mongodb.db().dropDatabase();
}

export async function resetDB(provider: SQLProvider) {
  const kysely = kyselyTests.find((kysely) => kysely.provider === provider)!;
  const db = kysely.db as Kysely<any>;

  if (provider === "mysql") {
    await db.transaction().execute(async () => {
      await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
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
      for (const table of tables) {
        await db.schema.dropTable(table.TABLE_NAME).ifExists().execute();
      }

      await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
    });

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

  if (provider === "postgresql" || provider === "cockroachdb") {
    const tables = await db
      .selectFrom("information_schema.tables")
      .select(["table_schema", "table_name"])
      .where("table_type", "=", "BASE TABLE")
      .where("table_schema", "not in", [
        "pg_catalog",
        "information_schema",
        "crdb_internal",
      ])
      .execute();

    for (const t of tables) {
      await db.schema
        .dropTable(`${t.table_schema}.${t.table_name}`)
        .ifExists()
        .cascade()
        .execute();
    }
    return;
  }

  if (provider === "mssql") {
    const tables = await db
      .selectFrom("information_schema.tables")
      .select(["table_schema", "table_name", "ss.schema_id"])
      .where("table_type", "=", "BASE TABLE")
      .where("table_schema", "not in", ["sys", "INFORMATION_SCHEMA"])
      .innerJoin("sys.schemas as ss", "table_schema", "ss.name")
      .execute();

    await Promise.all(
      tables.map(async (t) => {
        const constraints = await db
          .selectFrom("sys.foreign_keys as fk")
          .innerJoin("sys.objects as o", "fk.parent_object_id", "o.object_id")
          .select(["fk.name as constraint_name"])
          .where("o.name", "=", t.table_name)
          .where("o.schema_id", "=", t.schema_id)
          .execute();

        for (const { constraint_name } of constraints) {
          await db.schema
            .alterTable(t.table_name)
            .dropConstraint(constraint_name)
            .execute();
        }
      })
    );

    await Promise.all(
      tables.map(async (t) => {
        await db.schema.dropTable(t.table_name).execute();
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
