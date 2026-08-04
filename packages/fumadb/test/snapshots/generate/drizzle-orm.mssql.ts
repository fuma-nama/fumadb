import { mssqlTable, varchar, customType } from "drizzle-orm/mssql-core"
import { createId } from "fumadb/cuid"
import { relations } from "drizzle-orm/_relations"

export const users = mssqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey().notNull().$defaultFn(() => createId()),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  image: varchar("image", { length: 200 }).default("my-avatar")
})

export const usersRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, {
    relationName: "users_accounts",
    fields: [users.id],
    references: [accounts.id]
  }),
  posts: many(posts, {
    relationName: "posts_users"
  })
}));

export const accounts = mssqlTable("accounts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull()
})

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, {
    relationName: "users_accounts",
    fields: [accounts.id],
    references: [users.id]
  })
}));

const customBinary = customType<
  {
    data: Uint8Array;
    driverData: Buffer;
  }
>({
  dataType() {
    return "varbinary(max)";
  },
  fromDriver(value) {
    if (value == null || (value as any) === "") return null as unknown as Uint8Array;
    return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  },
  toDriver(value) {
    return value instanceof Buffer? value : Buffer.from(value)
  }
});

export const posts = mssqlTable("posts", {
  id: varchar("id", { length: 255 }).primaryKey().notNull().$defaultFn(() => createId()),
  authorId: varchar("author_id", { length: 255 }).notNull(),
  content: varchar("content", { length: "max" }).notNull(),
  image: customBinary("image")
})

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    relationName: "posts_users",
    fields: [posts.authorId],
    references: [users.id]
  })
}));