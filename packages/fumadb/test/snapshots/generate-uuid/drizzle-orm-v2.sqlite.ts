import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { defineRelations } from "drizzle-orm"

export const users = sqliteTable("users", {
  id: text("id").primaryKey().notNull(),
  email: text("email", { length: 255 }).notNull(),
  sessionToken: text("session_token")
})

export const relations = defineRelations({ users })