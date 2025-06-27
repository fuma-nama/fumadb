import { expect, test } from "vitest";
import { buildWhere } from "../src/query/orm/kysely";
import { expressionBuilder, PostgresQueryCompiler } from "kysely";
import {
  AbstractColumn,
  AbstractTableInfo,
  eb as b,
  Condition,
} from "../src/query";
import { table } from "../src/schema";
import { config } from "./shared";
import { fumadb } from "../src";
test("build conditions", async () => {
  const eb = expressionBuilder<any, any>();
  const users = table("users", {
    test: {
      type: "date",
      name: "test",
    },
    name: {
      type: "string",
      name: "name",
    },
    time: {
      type: "timestamp",
      name: "date",
    },
  });

  const info = new AbstractTableInfo("users", users);
  const name = new AbstractColumn<string>("name", info, users.columns.name);
  const test = new AbstractColumn<string>("test", info, users.columns.test);
  const time = new AbstractColumn<Date>("time", info, users.columns.time);
  const compiler = new PostgresQueryCompiler();

  const conditons = [
    b(test, "=", "value"),

    b.or(
      b.and(b.isNotNull(test), b(test, ">", name)),
      b(time, "<=", new Date(0))
    ),
  ];

  for (const condition of conditons) {
    const compiled = compiler.compileQuery(
      buildWhere(condition as Condition, eb).toOperationNode() as any,
      {
        queryId: "id",
      }
    );

    expect([compiled.sql, compiled.parameters]).toMatchSnapshot();
  }
});

const myDB = fumadb({
  namespace: "test",
  schemas: [
    {
      version: "1.0.0",
      tables: {
        users: table("users", {
          name: {
            type: "string",
            name: "name",
          },
        }),
      },
    },
  ],
});

test.each(config)("query $provider", async (item) => {
  const instance = myDB.configure({
    type: "kysely",
    db: item.db,
    provider: item.provider,
  });

  await item.db.schema.dropTable("users").ifExists().execute();

  const migrator = await instance.createMigrator();
  await migrator.versionManager.set_sql("0.0.0").execute();
  await migrator.migrateToLatest().then((res) => res.execute());

  const { tables, ...orm } = instance.abstract;
  await orm.createMany(tables.users, [
    {
      name: "fuma",
    },
  ]);

  const userList = await orm.findMany(tables.users, {
    select: true,
  });

  expect(userList).toMatchSnapshot();
});
