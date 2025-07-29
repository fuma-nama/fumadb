import { expect, test } from "vitest";
import {
  databases,
  drizzleTests,
  initDrizzleClient,
  kyselyTests,
  prismaTests,
  resetDB,
} from "../shared";
import { inspect } from "node:util";
import { fumadb, InferFumaDB } from "../../src";
import { v1 } from "./relations.schema";
import { prismaAdapter } from "../../src/adapters/prisma";
import { drizzleAdapter } from "../../src/adapters/drizzle";
import { kyselyAdapter } from "../../src/adapters/kysely";

const testDB = fumadb({
  schemas: [v1],
  namespace: "test",
}).names({
  posts: { prisma: "Posts" },
});

async function run(client: InferFumaDB<typeof testDB>) {
  const orm = client.abstract;
  const lines: string[] = [];

  lines.push("create initial records");
  await orm.createMany("users", [
    {
      id: "fuma",
      name: "fuma",
    },
    {
      id: "alfon",
      name: "alfonsus",
    },
    {
      id: "joulev",
      name: "joulev",
    },
  ]);
  await orm.createMany("posts", [
    {
      id: "1",
      authorId: "fuma",
      content: "hello world",
    },
    {
      id: "2",
      authorId: "joulev",
      relyTo: "1",
      attachmentUrl: "attachment-1",
    },
    {
      id: "3",
      authorId: "alfon",
      content: "hehe",
    },
  ]);
  await orm.createMany("attachments", [
    {
      id: "1",
      url: "attachment-1",
      data: new Uint8Array([1, 2, 3, 4]),
    },
  ]);

  lines.push("get initial records");
  lines.push(
    inspect(await orm.findMany("users", { orderBy: ["id", "asc"] }), {
      depth: null,
      sorted: true,
    })
  );
  lines.push(
    inspect(await orm.findMany("posts"), { depth: null, sorted: true })
  );
  lines.push(
    inspect(await orm.findMany("attachments"), { depth: null, sorted: true })
  );

  lines.push("delete alfon, his posts should also be deleted");
  // deleting posts only works because it is not relied by any posts
  await orm.deleteMany("users", {
    where: (b) => b("id", "=", "alfon"),
  });
  lines.push(
    inspect(await orm.findMany("posts"), { depth: null, sorted: true })
  );

  lines.push(
    "update attachment url of post 2, attachment url should also be updated"
  );
  await orm.updateMany("posts", {
    where: (b) => b("id", "=", "2"),
    set: {
      attachmentUrl: "attachment-1-updated",
    },
  });
  lines.push(
    inspect(await orm.findMany("attachments"), { depth: null, sorted: true })
  );

  lines.push("delete post, attachment should also be deleted");
  await orm.deleteMany("posts", {
    where: (b) => b("id", "=", "2"),
  });
  lines.push(
    inspect(await orm.findMany("attachments"), { depth: null, sorted: true })
  );

  return lines.join("\n");
}

test.each(kyselyTests)("query relations: kysely $provider", async (item) => {
  await resetDB(item.provider);

  const client = testDB.client(
    kyselyAdapter({
      db: item.db,
      provider: item.provider,
    })
  );

  await client
    .createMigrator()
    .migrateToLatest()
    .then((res) => res.execute());

  await expect(await run(client)).toMatchFileSnapshot("relations.output.txt");
});

test.each(drizzleTests)(
  "query relations: drizzle ($provider)",
  async (item) => {
    await resetDB(item.provider);
    const db = await initDrizzleClient(v1, item.provider);

    const client = testDB.client(
      drizzleAdapter({
        db,
        provider: item.provider,
      })
    );

    await expect(await run(client)).toMatchFileSnapshot("relations.output.txt");
  }
);

test.each(prismaTests)(
  "query relations: prisma ($provider)",
  { timeout: Infinity },
  async (item) => {
    const prismaClient = await item.init(v1);

    const client = testDB.client(
      prismaAdapter({
        prisma: prismaClient,
        provider: item.provider,
        db:
          item.provider === "mongodb"
            ? databases.find((db) => db.provider === "mongodb")!.create()
            : undefined,
      })
    );

    await expect(await run(client)).toMatchFileSnapshot("relations.output.txt");
    await prismaClient.$disconnect();
  }
);
