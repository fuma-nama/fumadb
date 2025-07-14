import { defineTable } from "convex/server";
import { v } from "convex/values";
import { createId as generateId } from "../../../src/cuid";

export const users = defineTable({
  id: v.string("id"),
  name: v("string"), validate: (value) => value.length <= 255
  email: v("string"), validate: (value) => value.length <= 255
  image: v.optional(v("string")), validate: (value) => value.length <= 200, default: "my-avatar"
}, {
  indexes: {
    "by_id": { fields: ["id"] },
    "by_id": { fields: ["id"] },
  }
});

export const accounts = defineTable({
  id: v("id"), primaryKey: true
}, {
  indexes: {
    "by_id": { fields: ["id"] },
  }
});

export const posts = defineTable({
  id: v("id"), primaryKey: true, default: () => generateId()
  authorId: v("string"), validate: (value) => value.length <= 255, name: "author_id"
  content: v("string")
  image: v.optional(v("string"))
}, {
  indexes: {
    "by_authorId": { fields: ["authorId"] },
  }
});
