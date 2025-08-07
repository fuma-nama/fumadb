import { fumadb, type InferFumaDB } from "fumadb";
import { column, idColumn, schema, table } from "fumadb/schema";

const v1 = schema({
  version: "1.0.0",
  tables: {
    user: table("user", {
      id: idColumn("name", "varchar(255)", {
        default: "auto",
      }),
    }),
  },
});

const v2 = schema({
  version: "1.1.0",
  tables: {
    user: table("user", {
      id: idColumn("name", "varchar(255)", {
        default: "auto",
      }),
      name: column("name", "string", { nullable: true }),
    }),
  },
});

export const myLib = fumadb({
  namespace: "lib",
  schemas: [v1, v2],
});

export function createMyLib(options: { db: InferFumaDB<typeof myLib> }) {
  const { db } = options;

  return {
    async getUser() {
      const version = await db.version();

      if (version === "1.1.0") {
        const orm = db.orm(version);

        return orm.findFirst("user", {
          select: true,
          where: (b) => b.and(b("id", "=", "fds"), b("name", "=", "test")),
        });
      }

      const orm = db.orm(version);

      return orm.findFirst("user", {
        select: true,
        where: (b) => b("id", "=", "fds"),
      });
    },
  };
}
