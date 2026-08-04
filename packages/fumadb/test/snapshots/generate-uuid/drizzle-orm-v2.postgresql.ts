import { pgTable, uuid, varchar } from "drizzle-orm/pg-core"
import { defineRelations } from "drizzle-orm"

export const users = pgTable("users", {
  id: uuid("id").primaryKey().notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  sessionToken: uuid("session_token")
})

export const relations = defineRelations({ users })