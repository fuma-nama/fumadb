import { describe, expect, test } from "vitest";
import { kyselyTests, resetDB } from "../shared";
import { inspect } from "node:util";
import { fumadb, InferFumaDB } from "../../src";
import { v1 } from "./relations.schema";

const testDB = fumadb({
  schemas: [v1],
  namespace: "test",
});

async function run(client: InferFumaDB<typeof testDB>) {
  const {
    tables: { attachments, posts, users },
    ...orm
  } = client.abstract;
  const lines: string[] = [];

  lines.push("create initial records");
  await orm.createMany(users, [
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
  await orm.createMany(posts, [
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
  ]);
  await orm.createMany(attachments, [
    {
      id: "1",
      url: "attachment-1",
      data: new Uint8Array([1, 2, 3, 4]),
    },
  ]);

  lines.push("get initial records");
  lines.push(
    inspect(await orm.findMany(users, { orderBy: [users.id, "asc"] }), {
      depth: null,
      sorted: true,
    })
  );
  lines.push(inspect(await orm.findMany(posts), { depth: null, sorted: true }));
  lines.push(
    inspect(await orm.findMany(attachments), { depth: null, sorted: true })
  );

  return lines.join("\n");
}
describe("query relations", async () => {
  test.each(kyselyTests)("kysely $provider", async (item) => {
    await resetDB(item.provider);

    const client = testDB.configure({
      type: "kysely",
      db: item.db,
      provider: item.provider,
    });

    await client
      .createMigrator()
      .then((migrator) => migrator.migrateToLatest())
      .then((res) => res.execute());

    await expect(await run(client)).toMatchFileSnapshot("relations.output.txt");
  });
});
