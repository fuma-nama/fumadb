import { mysqlTable, serial, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial().primaryKey().notNull(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull(),
  image: varchar({ length: 200 }).default("my-avatar"),
});

export const accounts = mysqlTable("accounts", {
  id: varchar({ length: 255 }).primaryKey().notNull(),
});
