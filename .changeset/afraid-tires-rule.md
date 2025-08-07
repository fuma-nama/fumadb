---
"fumadb": minor
---

[breaking] Change syntax for column builder to simplify types

```ts
import { table, column, idColumn } from "fumadb/schema";

const users = table("users", {
  // `defaultTo$` for generated default value
  id: idColumn("id", "varchar(255)").defaultTo$("auto"),
  timestamp: column("timestamp", "date").defaultTo$("now"),
  name: column("name", "string").defaultTo$(() => myFn()),

  // or database-level default value
  image: column("image", "string").defaultTo("haha"),

  // nullable
  email: column("email", "string").nullable(),
});
```
