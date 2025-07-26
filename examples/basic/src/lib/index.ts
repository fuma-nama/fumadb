import { fumadb, type InferFumaDB } from "fumadb";
import { idColumn, schema, table } from "fumadb/schema";

export const myLib = fumadb({
  namespace: "lib",
  schemas: [
    schema({
      version: "1.0.0" as const,
      tables: {
        user: table("user", {
          id: idColumn("name", "varchar(255)", {
            default: "auto",
          }),
        }),
      },
    }),
  ],
});

export function createMyLib(options: { db: InferFumaDB<typeof myLib> }) {
  const { db } = options;
  const orm = db.abstract;

  return {
    async getUser() {
      const result = await orm.findFirst("user", {
        select: true,
        where: (b) => b.and(b.isNotNull("id"), b("id", "=", "fds")),
      });

      return result;
    },
  };
}
