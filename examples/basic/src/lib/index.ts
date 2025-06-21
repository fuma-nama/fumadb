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
      const result = await orm.findOne(user, {
        select: "*",
        where: [
          [user.id, "=", "test"],
          [user.id, "=", "fds"],
        ],
      });

      return result;
    },
  };
}
