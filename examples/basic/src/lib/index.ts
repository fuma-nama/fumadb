import { fumadb, UserConfig } from "fumadb";
import { schema, table } from "fumadb/schema";

export const myLib = fumadb({
  namespace: "lib",
  schemas: [
    schema({
      version: "1.0.0" as const,
      tables: {
        user: table("user", {
          id: {
            name: "id",
            type: "varchar(255)",
            primarykey: true,
          },
        }),
      },
    }),
  ],
});

export function createMyLib(options: {
  db: ReturnType<typeof myLib.configure>;
}) {
  const { db } = options;
  const orm = db.abstract;
  const { user } = orm.tables;

  return {
    async getUser() {
      const result = await orm.findFirst(user, {
        select: true,
        where: (b) => b.and(b(user.id, "is not", null), b(user.id, "=", "fds")),
      });

      return result;
    },
  };
}
