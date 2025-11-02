import { table, column, idColumn, schema } from "../src/schema";
import { generateUUID } from "../src/uuid";
import { expect, test } from "vitest";
import * as Prisma from "../src/adapters/prisma/generate";
import * as Drizzle from "../src/adapters/drizzle/generate";
import * as TypeORM from "../src/adapters/typeorm/generate";

test("generateUUID returns valid UUID v4", () => {
  const uuid = generateUUID();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  expect(uuid).toMatch(uuidRegex);
});

test("generateUUID generates unique values", () => {
  const uuid1 = generateUUID();
  const uuid2 = generateUUID();
  expect(uuid1).not.toBe(uuid2);
});

test("idColumn accepts uuid type", () => {
  const col = idColumn("id", "uuid");
  expect(col.type).toBe("uuid");
  expect(col.id).toBe(true);
});

test("column accepts uuid type", () => {
  const col = column("token", "uuid");
  expect(col.type).toBe("uuid");
});

test("uuid column with defaultTo$ uuid", () => {
  const col = column("token", "uuid").defaultTo$("uuid");
  const defaultValue = col.generateDefaultValue();
  expect(typeof defaultValue).toBe("string");
  expect(defaultValue).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test("schema with UUID id column", () => {
  const s = schema({
    version: "1.0.0",
    tables: {
      users: table("users", {
        id: idColumn("id", "uuid").defaultTo$("uuid"),
        name: column("name", "string"),
      }),
    },
  });

  expect(s.tables.users.getIdColumn().type).toBe("uuid");
});

test("schema with UUID regular column", () => {
  const s = schema({
    version: "1.0.0",
    tables: {
      sessions: table("sessions", {
        id: idColumn("id", "varchar(255)").defaultTo$("auto"),
        sessionToken: column("session_token", "uuid").nullable(),
      }),
    },
  });

  expect(s.tables.sessions.columns.sessionToken.type).toBe("uuid");
});

// Test schema generation for different adapters
const uuidSchema = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "uuid").defaultTo$("uuid"),
      email: column("email", "varchar(255)"),
      sessionToken: column("session_token", "uuid").nullable(),
    }),
  },
});

test("Prisma PostgreSQL generates UUID schema correctly", () => {
  const generated = Prisma.generateSchema(uuidSchema, "postgresql");

  expect(generated).toContain("id String @db.Uuid @id @default(uuid())");
  expect(generated).toContain("sessionToken String? @map(\"session_token\") @db.Uuid");
});

test("Prisma MySQL generates UUID schema correctly", () => {
  const generated = Prisma.generateSchema(uuidSchema, "mysql");

  expect(generated).toContain("id String @id @default(uuid())");
  expect(generated).toContain("sessionToken String? @map(\"session_token\")");
});

test("Drizzle PostgreSQL generates UUID schema correctly", () => {
  const generated = Drizzle.generateSchema(uuidSchema, "postgresql");

  expect(generated).toContain("uuid(");
  expect(generated).toContain("defaultRandom()");
});

test("Drizzle MySQL generates UUID schema correctly", () => {
  const generated = Drizzle.generateSchema(uuidSchema, "mysql");

  expect(generated).toContain('char("id", { length: 36 })');
  expect(generated).toContain("generateUUID");
});

test("Drizzle SQLite generates UUID schema correctly", () => {
  const generated = Drizzle.generateSchema(uuidSchema, "sqlite");

  expect(generated).toContain('text("id")');
  expect(generated).toContain("generateUUID");
});

test("TypeORM generates UUID schema correctly", () => {
  const generated = TypeORM.generateSchema(uuidSchema, "postgresql");

  expect(generated).toContain('type: "uuid"');
  expect(generated).toContain("uuid_generate_v4()");
});

// Test mixing UUID and CUID2
const mixedSchema = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: idColumn("id", "uuid").defaultTo$("uuid"),
      name: column("name", "string"),
    }),
    posts: table("posts", {
      id: idColumn("id", "varchar(255)").defaultTo$("auto"),
      authorId: column("author_id", "uuid"),
      content: column("content", "string"),
    }),
  },
});

test("schema can mix UUID and CUID2 IDs", () => {
  expect(mixedSchema.tables.users.getIdColumn().type).toBe("uuid");
  expect(mixedSchema.tables.posts.getIdColumn().type).toBe("varchar(255)");
  expect(mixedSchema.tables.posts.columns.authorId.type).toBe("uuid");
});

test("Prisma generates mixed UUID and CUID2 schema correctly", () => {
  const generated = Prisma.generateSchema(mixedSchema, "postgresql");

  expect(generated).toContain("@default(uuid())");
  expect(generated).toContain("@default(cuid())");
});
