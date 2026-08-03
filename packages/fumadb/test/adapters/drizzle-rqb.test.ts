import { expect, test, vi } from "vitest";
import { generateSchema } from "../../src/adapters/drizzle/generate";
import { fromDrizzle } from "../../src/adapters/drizzle/query";
import { parseDrizzle, resolveRelationsVersion } from "../../src/adapters/drizzle/shared";
import { column, idColumn, schema, table } from "../../src/schema";

const usersTable = table("users", {
  id: idColumn("id", "varchar(255)"),
  name: column("name", "varchar(255)"),
  age: column("age", "integer"),
});

const querySchema = schema({
  version: "1.0.0",
  tables: { users: usersTable },
});

const compositeSchema = schema({
  version: "1.0.0",
  tables: {
    users: table("users", {
      tenantId: column("tenant_id", "varchar(255)"),
      id: idColumn("id", "varchar(255)"),
    }).unique("users_tenant_id_uk", ["tenantId", "id"]),
    accounts: table("accounts", {
      id: idColumn("id", "varchar(255)"),
      tenantId: column("tenant_id", "varchar(255)"),
      userId: column("user_id", "varchar(255)"),
    }),
  },
  relations: {
    accounts: ({ one }) => ({
      user: one("users", ["tenantId", "tenantId"], ["userId", "id"]).foreignKey(),
    }),
  },
});

function drizzleCols() {
  return {
    id: { name: "id" },
    name: { name: "name" },
    age: { name: "age" },
  };
}

function mockDb(mode: "v0" | "v1" | "empty" | "broken-relations") {
  const findMany = vi.fn().mockResolvedValue([]);
  const cols = drizzleCols();

  if (mode === "empty") {
    return { db: { _: {} }, findMany };
  }

  if (mode === "broken-relations") {
    return {
      db: { _: { relations: { users: {} } } },
      findMany,
    };
  }

  const db =
    mode === "v0"
      ? {
          _: { fullSchema: { users: cols } },
          query: { users: { findMany } },
          $count: vi.fn().mockResolvedValue(0),
          select: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          transaction: vi.fn(),
        }
      : {
          _: { relations: { users: { table: cols } } },
          query: { users: { findMany } },
          $count: vi.fn().mockResolvedValue(0),
          select: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          transaction: vi.fn(),
        };

  return { db, findMany };
}

test("parseDrizzle detects 0.x via fullSchema", () => {
  const { db } = mockDb("v0");
  const [, tables, major] = parseDrizzle(db);
  expect(major).toBe(0);
  expect(tables.users).toBeDefined();
});

test("parseDrizzle detects 1.x via relations[].table", () => {
  const { db } = mockDb("v1");
  const [, tables, major] = parseDrizzle(db);
  expect(major).toBe(1);
  expect(tables.users).toBeDefined();
});

test("parseDrizzle rejects unconfigured db", () => {
  const { db } = mockDb("empty");
  expect(() => parseDrizzle(db)).toThrow(/query mode/);
});

test("parseDrizzle rejects relations entries without .table", () => {
  const { db } = mockDb("broken-relations");
  expect(() => parseDrizzle(db)).toThrow(/missing \.table/);
});

test("resolveRelationsVersion maps majors and falls back when unconfigured", () => {
  expect(resolveRelationsVersion(mockDb("v0").db)).toBe(1);
  expect(resolveRelationsVersion(mockDb("v1").db)).toBe(2);
  // Current install is drizzle-orm 1.x RC, which exports defineRelations.
  expect(resolveRelationsVersion(mockDb("empty").db)).toBe(2);
});

test("findMany uses SQL where/orderBy on RQB v1 (drizzle 0.x)", async () => {
  const { db, findMany } = mockDb("v0");
  const orm = fromDrizzle(querySchema, db, "postgresql");

  await orm.findMany("users", {
    where: (b) => b("name", "=", "fuma"),
    orderBy: ["id", "asc"],
  });

  expect(findMany).toHaveBeenCalledOnce();
  const config = findMany.mock.calls[0]![0] as {
    where: unknown;
    orderBy: unknown[];
  };
  expect(config.orderBy).toHaveLength(1);
  expect(Array.isArray(config.orderBy)).toBe(true);
  // SQL wrappers from drizzle-orm, not plain objects
  expect(config.where).not.toEqual({ name: "fuma" });
  expect(config.where).toBeTruthy();
});

test("findMany uses object where/orderBy on RQB v2 (drizzle 1.x)", async () => {
  const { db, findMany } = mockDb("v1");
  const orm = fromDrizzle(querySchema, db, "postgresql");

  await orm.findMany("users", {
    where: (b) => b.and(b("name", "=", "fuma"), b("age", ">", 18)),
    orderBy: ["id", "desc"],
  });

  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        AND: [{ name: "fuma" }, { age: { gt: 18 } }],
      },
      orderBy: { id: "desc" },
    }),
  );
});

test("findMany maps string contains to like on RQB v2", async () => {
  const { db, findMany } = mockDb("v1");
  const orm = fromDrizzle(querySchema, db, "postgresql");

  await orm.findMany("users", {
    where: (b) => b("name", "contains", "fu"),
  });

  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { name: { like: "%fu%" } },
    }),
  );
});

test("generateSchema v2 emits array from/to for composite relations", () => {
  const code = generateSchema(compositeSchema, "postgresql", 2);
  expect(code).toContain("defineRelations");
  expect(code).toContain("from: [r.accounts.tenantId, r.accounts.userId]");
  expect(code).toContain("to: [r.users.tenantId, r.users.id]");
});
