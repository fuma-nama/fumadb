import * as fs from "node:fs/promises";
import { generate } from "./generate";
import { Schema, table } from "./create";
import { abstractQuery } from "../query";
import { fumadb } from "..";

export const mySchema = {
  version: "1.0.0",
  tables: {
    users: table("users", {
      id: {
        name: "id",
        type: "serial",
      },
      name: {
        name: "name",
        type: "varchar(255)",
      },
      email: {
        name: "email",
        type: "varchar(255)",
        nullable: true,
      },
    }),
    accounts: table("accounts", {
      uuid: {
        name: "uuid",
        type: "serial",
      },
    }),
  },
} satisfies Schema;

const out = await generate(mySchema, {
  type: "drizzle-orm",
});

await fs.writeFile("src/db/schema.ts", out);

const db = fumadb(mySchema).abstract;
export const { accounts, users } = db.tables;

db.findOne(users, {
  select: true,
  where: [
    [users.email, "=", "test@gmail.com"],
    "and",
    [accounts.uuid, "=", "sfd"],
  ],
});
