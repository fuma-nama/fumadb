import { drizzleAdapter } from "../../src/adapters/drizzle";
import { kyselyAdapter } from "../../src/adapters/kysely";
import { prismaAdapter } from "../../src/adapters/prisma";
import { mongoAdapter } from "../../src/adapters/mongodb";
import { expect, test } from "vitest";
import {
  kyselyTests,
  drizzleTests,
  prismaTests,
  resetDB,
  databases,
  resetMongoDB,
  initDrizzleClient,
} from "../shared";
import { fumadb } from "../../src";
import { AbstractQuery } from "../../src/query";
import { v1 } from "./query.schema";
import { inspect } from "node:util";

const myDB = fumadb({
  namespace: "test",
  schemas: [v1],
})
  .prefix(true)
  .names({
    users: { prisma: "PrismaUser" },
    "users.id": {
      sql: "user_id",
      prisma: "UserId",
    },
  });
async function run(orm: AbstractQuery<typeof v1>): Promise<string> {
  const lines: string[] = [];

  lines.push("create one");
  lines.push(
    inspect(
      await orm.create("users", {
        id: "generated-cuid",
        name: "fuma",
      }),
      { depth: null, sorted: true }
    )
  );
  lines.push("create other users");
  lines.push(
    inspect(
      await orm.createMany("users", [
        {
          id: "alfon",
          name: "alfon",
        },
        {
          id: "test",
          name: "Test User",
        },
      ]),
      { depth: null, sorted: true }
    )
  );

  lines.push("initial data ready");
  await orm.createMany("messages", [
    {
      user: "alfon",
      content: "Hello World 1 by alfon",
      id: "1",
    },
    {
      user: "alfon",
      content: "Hello World 2 by alfon",
      id: "2",
      mentionId: "1",
    },
  ]);
  lines.push(
    inspect(await orm.findMany("users", { orderBy: ["id", "asc"] }), {
      depth: null,
      sorted: true,
    }),
    inspect(await orm.findMany("messages", { orderBy: ["id", "asc"] }), {
      depth: null,
      sorted: true,
    })
  );

  lines.push("test joins: user -> messages -> mentioned by");
  lines.push(
    inspect(
      await orm.findMany("users", {
        orderBy: ["id", "asc"],
        join: (b) =>
          b.messages({
            orderBy: ["id", "asc"],
            join: (b) =>
              b.mentionedBy({
                join: (b) => b.author(),
              }),
          }),
      }),
      { depth: null, sorted: true }
    )
  );

  lines.push("test joins: user -> messages (conditional) -> author");
  lines.push(
    inspect(
      await orm.findMany("users", {
        orderBy: ["id", "asc"],
        join: (b) =>
          b.messages({
            orderBy: ["id", "asc"],
            select: ["content"],
            limit: 1,
            where: (b) => b("content", "contains", "alfon"),
            join: (b) => b.author(),
          }),
      }),
      { depth: null, sorted: true }
    )
  );

  lines.push(`count users: ${await orm.count("users")}`);

  const getBob = () =>
    orm.findFirst("users", { where: (b) => b("id", "=", "bob") });
  const upsertBob = (v: string) =>
    orm.upsert("users", {
      where: (b) => b("id", "=", "bob"),
      create: { id: "bob", name: v },
      update: { name: v },
    });

  lines.push("upsert bob: should be created as sad");
  await upsertBob("Bob is sad");
  lines.push(inspect(await getBob(), { depth: null, sorted: true }));

  lines.push("upsert bob: should be updated to happy");
  await upsertBob("Bob is happy");
  lines.push(inspect(await getBob(), { depth: null, sorted: true }));

  lines.push("insert with binary data");
  lines.push(
    inspect(
      await orm.create("messages", {
        id: "image-test",
        user: "alfon",
        content: "test",
        image: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      }),
      { depth: null, sorted: true }
    )
  );

  await orm
    .transaction(async (tx) => {
      await tx.createMany("messages", [
        {
          id: "transaction-1",
          user: "alfon",
          content: "test message",
        },
        {
          id: "transaction-2",
          user: "bob",
          content: "haha",
        },
      ]);

      await tx.deleteMany("messages", {
        where: (b) => b("id", "=", "image-test"),
      });

      lines.push("should be able to select affected records in transaction");
      lines.push(
        inspect(
          await tx.findMany("messages", {
            orderBy: ["id", "asc"],
          }),
          { depth: null, sorted: true }
        )
      );

      throw new Error("Rollback!");
    })
    .catch((e: Error) => {
      expect(e.message).toBe("Rollback!");
    });

  lines.push("after rollback, the changes should not be kept");

  lines.push(
    inspect(
      await orm.findMany("messages", {
        orderBy: ["id", "asc"],
      }),
      { depth: null, sorted: true }
    )
  );

  await expect(
    orm.create("messages", {
      user: "invalid",
      id: "invalid-message",
    })
  ).rejects.toThrowError();

  return lines.join("\n");
}

test.each(kyselyTests)(
  "query kysely ($provider)",
  { timeout: Infinity },
  async (item) => {
    await resetDB(item.provider);
    const client = myDB.client(
      kyselyAdapter({
        db: item.db,
        provider: item.provider,
      })
    );

    const migrator = await client.createMigrator();
    await migrator.migrateToLatest().then((res) => res.execute());

    const result = await run(client.abstract);
    await expect(result).toMatchFileSnapshot(`query.output.txt`);
  }
);

test("query mongodb", async () => {
  const mongodb = databases.find((db) => db.provider === "mongodb")!.create();
  await mongodb.connect();
  await resetMongoDB(mongodb);

  const instance = myDB.client(
    mongoAdapter({
      client: mongodb,
    })
  );

  const orm = instance.abstract;
  await expect(await run(orm)).toMatchFileSnapshot("query.output.txt");
  await mongodb.close();
});

test.each(drizzleTests)("query drizzle ($provider)", async (item) => {
  await resetDB(item.provider);
  const db = await initDrizzleClient(v1, item.provider);

  const instance = myDB.client(
    drizzleAdapter({
      db,
      provider: item.provider,
    })
  );

  await expect(await run(instance.abstract)).toMatchFileSnapshot(
    "query.output.txt"
  );
});

test.each(prismaTests)(
  "query prisma ($provider)",
  { timeout: Infinity },
  async (item) => {
    const prismaClient = await item.init(v1);

    const instance = myDB.client(
      prismaAdapter({
        prisma: prismaClient,
        provider: item.provider,
        db:
          item.provider === "mongodb"
            ? databases.find((db) => db.provider === "mongodb")!.create()
            : undefined,
      })
    );

    const orm = instance.abstract;

    await expect(await run(orm)).toMatchFileSnapshot("query.output.txt");
    await prismaClient.$disconnect();
  }
);
