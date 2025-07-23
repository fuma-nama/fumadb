import { AnyRelation, AnySchema, ForeignKey, IdColumn } from "./create";

export function validateSchema(schema: AnySchema) {
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
        `[${key.name}] Due to the limitations of MSSQL, you cannot specify other foreign key actions than "RESTRICT" for self-referencing foreign keys.`
      );
    }

    for (const name of key.referencedColumns) {
      const col = schema.tables[key.referencedTable].columns[name];

      if (!col.unique && !(col instanceof IdColumn))
        throw new Error(
          `[${key.name}] For foreign key, the referenced columns must be unique or primary key, but ${name} is not.`
        );
    }
  }

  function validateRelation(relation: AnyRelation) {
    if (!relation.implied && !relation.foreignKey) {
      throw new Error(
        `[${relation.ormName}] You must define foreign key for explicit relations due the limitations of Prisma.`
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
