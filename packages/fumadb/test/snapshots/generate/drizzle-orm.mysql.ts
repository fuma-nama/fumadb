import { mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { createId } from "fumadb/cuid"
import { relations } from "drizzle-orm"

export const users = mysqlTable("users", {
  id: varchar({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  image: varchar({ length: 200 }).default("my-avatar")
})

export const usersRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, { fields: [users.id], references: [accounts.id] })
}));

export const accounts = mysqlTable("accounts", {
  id: varchar({ length: 255 }).primaryKey().notNull()
})

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users)
}));