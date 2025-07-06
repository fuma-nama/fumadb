import { pgTable, varchar, foreignKey, text } from "drizzle-orm/pg-core"
import { createId } from "fumadb/cuid"
import { relations } from "drizzle-orm"

export const users = pgTable("users", {
  id: varchar({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  image: varchar({ length: 200 }).default("my-avatar")
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

export const accounts = pgTable("accounts", {
  id: varchar({ length: 255 }).primaryKey().notNull()
})

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users)
}));

export const posts = pgTable("posts", {
  id: varchar({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  authorId: varchar("author_id", { length: 255 }).notNull(),
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