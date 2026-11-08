import { expect, test } from "vitest";
import { UniqueConstraintError } from "../src";
import { column, idColumn, table } from "../src/schema";
import { toUniqueConstraintError } from "../src/shared/errors";

const items = table("items", {
  id: idColumn("id", "varchar(255)"),
  bucket: column("bucket_name", "varchar(255)"),
  key: column("key", "varchar(255)"),
}).unique("items_bucket_key_uk", ["bucket", "key"]);

// Prisma 7 driver adapters put the violation in `meta.driverAdapterError`
function prismaError(constraint: unknown) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint } } },
  });
}

test.each([
  ["constraint name", prismaError({ index: "items_bucket_key_uk" }), "items_bucket_key_uk"],
  ["column names", prismaError({ fields: ["key", "bucket_name"] }), "items_bucket_key_uk"],
  ["primary key", prismaError({ fields: ["id"] }), undefined],
  ["no constraint", prismaError(undefined), undefined],
])("Prisma unique violation with %s", (_, error, constraint) => {
  const result = toUniqueConstraintError(items, error);
  expect(result).toBeInstanceOf(UniqueConstraintError);
  expect(result!.constraint).toBe(constraint);
  expect(result!.cause).toBe(error);
});

test("other errors are not unique violations", () => {
  expect(toUniqueConstraintError(items, new Error("connection refused"))).toBeUndefined();
  expect(toUniqueConstraintError(items, { code: "P2003" })).toBeUndefined();
});
