import { sqliteTable, text, foreignKey } from "drizzle-orm/sqlite-core"
import { createId } from "fumadb/cuid"
import { relations } from "drizzle-orm"

export const users = sqliteTable("users", {
  id: text({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  name: text({ length: 255 }).notNull(),
  email: text({ length: 255 }).notNull(),
  image: text({ length: 200 }).default("my-avatar")
}, (table) => [
  foreignKey({
    columns: [table.id],
    foreignColumns: [accounts.id],
    name: "account_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

export const usersRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, {
    fields: [users.id],
    references: [accounts.id]
  }),
  posts: many(posts)
}));

export const accounts = sqliteTable("accounts", {
  id: text({ length: 255 }).primaryKey().notNull()
})

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users)
}));

export const posts = sqliteTable("posts", {
  id: text({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  authorId: text("author_id", { length: 255 }).notNull(),
  content: text().notNull()
}, (table) => [
  foreignKey({
    columns: [table.authorId],
    foreignColumns: [users.id],
    name: "author_fk"
  }).onUpdate("restrict").onDelete("restrict")
])

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id]
  })
}));