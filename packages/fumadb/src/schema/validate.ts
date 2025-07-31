import {
  type AnyRelation,
  type AnySchema,
  type ForeignKey,
  IdColumn,
} from "./create";
import { valid } from "semver";

export function validateSchema(schema: AnySchema) {
  if (!valid(schema.version)) {
    throw new Error(`the version ${schema.version} is invalid.`);
  }

  const tables = Object.values(schema.tables);

  function validateForeignKey(key: ForeignKey) {
    if (key.columns.length > 1)
      throw new Error(
        `[${key.name}] We do not support creating foreign key with multiple columns yet, because it requires composite unique constraint/index.`
      );

    if (
      key.table === key.referencedTable &&
      (key.onUpdate !== "RESTRICT" || key.onDelete !== "RESTRICT")
    ) {
      throw new Error(
        `[${key.name}] Due to the limitations of MSSQL & Prisma MongoDB, you cannot specify other foreign key actions than "RESTRICT" for self-referencing foreign keys.`
      );
    }

    for (const col of key.columns) {
      if (
        !col.nullable &&
        (key.onUpdate === "SET NULL" || key.onDelete === "SET NULL")
      ) {
        throw new Error(
          `[${key.name}] You are using "SET NULL" as foreign key action, but some columns are non-nullable.`
        );
      }
    }
  }

  function validateRelation(relation: AnyRelation) {
    if (!relation.implied && !relation.foreignKey) {
      throw new Error(
        `[${relation.name}] You must define foreign key for explicit relations due the limitations of Prisma.`
      );
    }

    for (const [left, right] of relation.on) {
      // ignore implied
      if (relation.implied) continue;
      const col = relation.referencer.columns[left];
      const refCol = relation.table.columns[right];

      if (
        relation.implying?.type === "one" &&
        !col.unique &&
        !(col instanceof IdColumn)
      ) {
        throw new Error(
          `[${relation.name}] one-to-one relations require both sides to be unique or primary key, but ${col.ormName} is not.`
        );
      }

      if (!refCol.unique && !(refCol instanceof IdColumn))
        throw new Error(
          `[${relation.name}] For any explicit relations, the referenced columns must be unique or primary key, but ${refCol.ormName} is not.`
        );
    }
  }

  for (const table of tables) {
    for (const foreignKey of table.foreignKeys) {
      validateForeignKey(foreignKey);
    }

    for (const relation of Object.values(table.relations)) {
      validateRelation(relation);
    }
  }
}
