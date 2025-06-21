import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }).notNull(),
  name: text({ length: 255 }).notNull(),
  email: text({ length: 255 }).notNull(),
  image: text({ length: 200 }).default("my-avatar"),
});

export const accounts = sqliteTable("accounts", {
  id: text({ length: 255 }).primaryKey().notNull(),
});
