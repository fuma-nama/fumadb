import { Kysely, PostgresDialect } from "kysely";
import { expect, test } from "vitest";
import { fumadb } from "../src";
import * as Drizzle from "../src/adapters/drizzle/generate";
import { kyselyAdapter } from "../src/adapters/kysely";
import * as Prisma from "../src/adapters/prisma/generate";
import { column, idColumn, schema, table } from "../src/schema";

const testSchema = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      name: column("name", "varchar(255)"),
    }).unique("users_id_unique", ["id"]),
  },
});

test("generate drizzle schema with postgres schema", async () => {
  const generated = Drizzle.generateSchema(
    testSchema,
    "postgresql",
    "my_schema"
  );
  expect(generated).toContain('export const schema = pgSchema("my_schema");');
  expect(generated).toContain('export const users = schema.table("users",');
});

test("generate prisma schema with schema", async () => {
  const generated = Prisma.generateSchema(
    testSchema,
    "postgresql",
    "my_schema"
  );
  expect(generated).toContain('@@schema("my_schema")');
});

test("kysely migration SQL with schema", async () => {
  // Helper to create query builder mocks with optional schema prefix
  const createQueryBuilder = (schemaPrefix?: string) => {
    const qualify = (name: string) =>
      schemaPrefix ? `"${schemaPrefix}"."${name}"` : `"${name}"`;
    return {
      selectFrom: (name: string) => ({
        where: (k: string, o: string, v: string) => ({
          select: () => ({
            executeTakeFirstOrThrow: async () => {
              if (v === "version") return { value: "0.0.0" };
              if (v === "name-variants") return { value: "{}" };
              return { value: undefined };
            },
          }),
        }),
      }),
      insertInto: (name: string) => ({
        values: () => ({
          compile: () => ({ sql: `insert into ${qualify(name)}` }),
        }),
      }),
      updateTable: (name: string) => ({
        set: () => ({
          where: () => ({
            compile: () => ({ sql: `update ${qualify(name)}` }),
          }),
        }),
      }),
    };
  };

  const db = {
    schema: {
      withSchema: (s: string) => ({
        createTable: (name: string) => ({
          addColumn: function () {
            return this;
          },
          compile: () => ({ sql: `create table "${s}"."${name}"` }),
        }),
        alterTable: (name: string) => ({
          addUniqueConstraint: (n: string, c: any) => ({
            compile: () => ({
              sql: `alter table "${s}"."${name}" add constraint "${n}"`,
            }),
          }),
        }),
      }),
      createTable: (name: string) => ({
        addColumn: function () {
          return this;
        },
        compile: () => ({ sql: `create table "${name}"` }),
      }),
      alterTable: (name: string) => ({
        addUniqueConstraint: (n: string, c: any) => ({
          compile: () => ({
            sql: `alter table "${name}" add constraint "${n}"`,
          }),
        }),
      }),
    },
    introspection: {
      getTables: async () => [],
    },
    // withSchema returns a scoped db for queries
    withSchema: (s: string) => createQueryBuilder(s),
    ...createQueryBuilder(),
  } as any;

  const adapter = kyselyAdapter({
    db,
    provider: "postgresql",
    schema: "my_schema",
  });

  const client = fumadb({
    namespace: "test",
    schemas: [testSchema],
  }).client(adapter);

  const migrator = client.createMigrator();
  const { getSQL } = await migrator.up();
  const sql = getSQL!();

  expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "my_schema";');
  expect(sql).toContain('create table "my_schema"."users"');
  expect(sql).toContain('create table "my_schema"."private_test_settings"');
  expect(sql).toContain(
    'alter table "my_schema"."users" add constraint "my_schema_users_id_unique"'
  );
});
