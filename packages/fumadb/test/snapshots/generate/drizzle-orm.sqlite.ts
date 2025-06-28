import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createId } from "fumadb/cuid"

export const users = sqliteTable("users", {
  id: text({ length: 255 }).primaryKey().$defaultFn(() => createId()).notNull(),
  name: text({ length: 255 }).notNull(),
  email: text({ length: 255 }).notNull(),
  image: text({ length: 200 }).default("my-avatar")
})

export const accounts = sqliteTable("accounts", {
  id: text({ length: 255 }).primaryKey().notNull()
})