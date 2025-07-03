import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createId } from "fumadb/cuid"
import { relations } from "drizzle-orm"

export const users = sqliteTable("users", {
  id: text({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  name: text({ length: 255 }).notNull(),
  email: text({ length: 255 }).notNull(),
  image: text({ length: 200 }).default("my-avatar")
})

export const usersRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, { fields: [users.id], references: [accounts.id] })
}));

export const accounts = sqliteTable("accounts", {
  id: text({ length: 255 }).primaryKey().notNull()
})

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users)
}));