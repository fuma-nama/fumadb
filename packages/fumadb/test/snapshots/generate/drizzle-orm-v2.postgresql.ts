import { pgTable, varchar, foreignKey, text, customType } from "drizzle-orm/pg-core"
import { createId } from "fumadb/cuid"
import { defineRelations } from "drizzle-orm"

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().notNull().$defaultFn(() => createId()),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  image: varchar("image", { length: 200 }).default("my-avatar")
}, (table) => [
  foreignKey({
    columns: [table.id],
    foreignColumns: [accounts.id],
    name: "users_accounts_account_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

export const accounts = pgTable("accounts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull()
})

const customBinary = customType<
  {
    data: Uint8Array;
    driverData: Buffer;
  }
>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  },
  toDriver(value) {
    return value instanceof Buffer? value : Buffer.from(value)
  }
});

export const posts = pgTable("posts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull().$defaultFn(() => createId()),
  authorId: varchar("author_id", { length: 255 }).notNull(),
  content: text("content").notNull(),
  image: customBinary("image")
}, (table) => [
  foreignKey({
    columns: [table.authorId],
    foreignColumns: [users.id],
    name: "posts_users_author_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

export const relations = defineRelations({ users, accounts, posts }, (r) => ({
  users: {
    account: r.one.accounts({
      from: r.users.id,
      to: r.accounts.id,
      alias: "users_accounts"
    }),
    posts: r.many.posts({
      alias: "posts_users"
    })
  },
  accounts: {
    user: r.one.users({
      from: r.accounts.id,
      to: r.users.id,
      alias: "users_accounts"
    })
  },
  posts: {
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
      alias: "posts_users"
    })
  }
}))