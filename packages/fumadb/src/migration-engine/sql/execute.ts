import {
  type ColumnBuilderCallback,
  type CreateTableBuilder,
  type Kysely,
  type OnModifyForeignAction,
  type RawBuilder,
  sql,
} from "kysely";
import {
  isUpdated,
  type ColumnOperation,
  type MigrationOperation,
  type SQLNode,
} from "../shared";
import type { SQLProvider } from "../../shared/providers";
import {
  type AnyColumn,
  type AnyTable,
  type ForeignKeyAction,
  IdColumn,
} from "../../schema/create";
import { schemaToDBType, isDefaultVirtual } from "../../schema/serialize";
import type { KyselyConfig } from "../../shared/config";

function getColumnBuilderCallback(
  col: AnyColumn,
  provider: SQLProvider
): ColumnBuilderCallback {
  return (build) => {
    if (!col.nullable) {
      build = build.notNull();
    }
    if (col instanceof IdColumn) build = build.primaryKey();

    const defaultValue = defaultValueToDB(col, provider);
    if (defaultValue) build = build.defaultTo(defaultValue);
    return build;
  };
}

const errors = {
  IdColumnUpdate:
    "ID columns must not be updated, not every database supports updating primary keys and often requires workarounds.",
  SQLiteUpdateForeignKeys:
    "In SQLite, you cannot modify foreign keys directly, use `recreate-table` instead.",
};

function createUniqueIndex(
  db: Kysely<any>,
  tableName: string,
  col: AnyColumn,
  provider: SQLProvider
) {
  const query = db.schema
    .createIndex(col.getUniqueConstraintName())
    .on(tableName)
    .column(col.names.sql)
    .unique();

  if (provider === "mssql") {
    // ignore null by default
    return query.where(`${tableName}.${col.names.sql}`, "is not", null);
  }

  return query;
}

function createUniqueIndexOrConstraint(
  db: Kysely<any>,
  tableName: string,
  col: AnyColumn,
  provider: SQLProvider
) {
  if (provider === "sqlite" || provider === "mssql") {
    return createUniqueIndex(db, tableName, col, provider);
  }

  return db.schema
    .alterTable(tableName)
    .addUniqueConstraint(col.getUniqueConstraintName(), [col.names.sql]);
}

function dropUniqueIndexOrConstraint(
  db: Kysely<any>,
  tableName: string,
  col: AnyColumn,
  provider: SQLProvider
) {
  // Cockroach DB needs to drop the index instead
  if (
    provider === "cockroachdb" ||
    provider === "sqlite" ||
    provider === "mssql"
  ) {
    let query = db.schema.dropIndex(col.getUniqueConstraintName()).ifExists();
    if (provider === "cockroachdb") query = query.cascade();
    if (provider === "mssql") query = query.on(tableName);

    return query;
  }

  return db.schema
    .alterTable(tableName)
    .dropConstraint(col.getUniqueConstraintName());
}

function executeColumn(
  tableName: string,
  operation: ColumnOperation,
  config: KyselyConfig
): SQLNode[] {
  const { db, provider } = config;
  const next = () => db.schema.alterTable(tableName);
  const results: SQLNode[] = [];

  switch (operation.type) {
    case "rename-column":
      results.push(next().renameColumn(operation.from, operation.to));
      return results;

    case "drop-column":
      results.push(next().dropColumn(operation.name));

      return results;
    case "create-column": {
      const col = operation.value;

      results.push(
        next().addColumn(
          col.names.sql,
          sql.raw(schemaToDBType(col, provider)),
          getColumnBuilderCallback(col, provider)
        )
      );

      if (col.unique)
        results.push(
          createUniqueIndexOrConstraint(db, tableName, col, provider)
        );
      return results;
    }
    case "update-column": {
      const col = operation.value;

      if (col instanceof IdColumn) throw new Error(errors.IdColumnUpdate);
      if (provider === "sqlite") {
        throw new Error(
          "SQLite doesn't support updating column, recreate the table instead."
        );
      }

      if (!isUpdated(operation)) return results;

      function onUpdateUnique() {
        results.push(
          col.unique
            ? createUniqueIndexOrConstraint(db, tableName, col, provider)
            : dropUniqueIndexOrConstraint(db, tableName, col, provider)
        );
      }

      if (provider === "mysql") {
        results.push(
          next().modifyColumn(
            operation.name,
            sql.raw(schemaToDBType(col, provider)),
            getColumnBuilderCallback(col, provider)
          )
        );
        if (operation.updateUnique) onUpdateUnique();
        return results;
      }

      if (provider === "mssql") {
        // mssql needs to re-create the default constraint
        results.push(
          rawToNode(db, mssqlDropDefaultConstraint(tableName, col.names.sql))
        );
      }

      if (operation.updateDataType)
        results.push(
          next().alterColumn(operation.name, (b) =>
            b.setDataType(sql.raw(schemaToDBType(col, provider)))
          )
        );

      if (operation.updateNullable) {
        results.push(
          next().alterColumn(operation.name, (build) =>
            col.nullable ? build.dropNotNull() : build.setNotNull()
          )
        );
      }

      if (provider !== "mssql" && operation.updateDefault) {
        results.push(
          next().alterColumn(operation.name, (build) => {
            const defaultValue = defaultValueToDB(col, provider);

            if (!defaultValue) return build.dropDefault();
            return build.setDefault(defaultValue);
          })
        );
      } else if (provider === "mssql") {
        const defaultValue = defaultValueToDB(col, provider);
        if (defaultValue) {
          const name = `DF_${tableName}_${col.names.sql}`;

          results.push(
            rawToNode(
              db,
              sql`ALTER TABLE ${sql.ref(tableName)} ADD CONSTRAINT ${sql.ref(name)} DEFAULT ${defaultValue} FOR ${sql.ref(col.names.sql)}`
            )
          );
        }
      }

      if (operation.updateUnique) onUpdateUnique();
      return results;
    }
  }
}

export function execute(
  operation: MigrationOperation,
  config: KyselyConfig
): SQLNode | SQLNode[] {
  const {
    db,
    provider,
    relationMode = provider === "mssql" ? "fumadb" : "foreign-keys",
  } = config;

  function createTable(table: AnyTable) {
    const results: SQLNode[] = [];
    let builder = db.schema.createTable(table.names.sql) as CreateTableBuilder<
      string,
      string
    >;

    for (const col of Object.values(table.columns)) {
      builder = builder.addColumn(
        col.names.sql,
        sql.raw(schemaToDBType(col, provider)),
        getColumnBuilderCallback(col, provider)
      );

      if (col.unique && (provider === "sqlite" || provider === "mssql")) {
        results.push(createUniqueIndex(db, table.names.sql, col, provider));
      } else if (col.unique) {
        builder = builder.addUniqueConstraint(col.getUniqueConstraintName(), [
          col.names.sql,
        ]);
      }
    }

    for (const foreignKey of table.foreignKeys) {
      if (relationMode === "fumadb") break;
      const compiled = foreignKey.compile();

      builder = builder.addForeignKeyConstraint(
        compiled.name,
        compiled.columns,
        compiled.referencedTable,
        compiled.referencedColumns,
        (b) =>
          b
            .onUpdate(mapForeignKeyAction(compiled.onUpdate, provider))
            .onDelete(mapForeignKeyAction(compiled.onDelete, provider))
      );
    }

    results.unshift(builder);
    return results;
  }

  function sqliteRecreateTable(prev: AnyTable, next: AnyTable) {
    const results: SQLNode[] = [];
    results.push(rawToNode(db, sql`PRAGMA foreign_keys = OFF`));

    for (const oldColumn of Object.values(prev.columns)) {
      if (oldColumn.unique) {
        results.push(
          dropUniqueIndexOrConstraint(db, prev.names.sql, oldColumn, provider)
        );
      }
    }

    const tempName = `_temp_${next.names.sql}`;
    results.push(
      ...createTable({
        ...next,
        names: {
          ...next.names,
          sql: tempName,
        },
      })
    );

    const colNames: string[] = [];
    const values: string[] = [];
    for (const prevCol of Object.values(prev.columns)) {
      const nextCol = next.columns[prevCol.ormName];
      if (!nextCol) continue;

      colNames.push(`"${nextCol.names.sql}"`);
      values.push(`"${prevCol.names.sql}" as "${nextCol.names.sql}"`);
    }

    results.push(
      rawToNode(
        db,
        sql.raw(
          `INSERT INTO "${tempName}" (${colNames.join(", ")}) SELECT ${values.join(", ")} FROM "${prev.names.sql}"`
        )
      )
    );
    results.push(
      db.schema.dropTable(prev.names.sql),
      db.schema.alterTable(tempName).renameTo(next.names.sql)
    );

    results.push(rawToNode(db, sql`PRAGMA foreign_keys = ON`));
    return results;
  }

  switch (operation.type) {
    case "create-table":
      return createTable(operation.value);
    case "rename-table":
      if (provider === "mssql") {
        return rawToNode(
          db,
          sql.raw(`EXEC sp_rename ${operation.from}, ${operation.to}`)
        );
      }

      return db.schema.alterTable(operation.from).renameTo(operation.to);
    case "update-table": {
      const results: SQLNode[] = [];

      for (const op of operation.value) {
        results.push(...executeColumn(operation.name, op, config));
      }

      return results;
    }
    case "drop-table":
      return db.schema.dropTable(operation.name);
    case "kysely-builder":
      return operation.value(db);
    case "sql":
      return rawToNode(db, sql.raw(operation.sql));
    case "recreate-table":
      if (provider !== "sqlite")
        throw new Error(
          `"recreate-table" operation is only available for SQLite.`
        );

      return sqliteRecreateTable(operation.previous, operation.next);
    case "add-foreign-key": {
      if (provider === "sqlite")
        throw new Error(errors.SQLiteUpdateForeignKeys);
      const { table, value } = operation;

      return db.schema
        .alterTable(table)
        .addForeignKeyConstraint(
          value.name,
          value.columns,
          value.referencedTable,
          value.referencedColumns,
          (b) =>
            b
              .onUpdate(mapForeignKeyAction(value.onUpdate, provider))
              .onDelete(mapForeignKeyAction(value.onDelete, provider))
        );
    }
    case "drop-foreign-key": {
      if (provider === "sqlite")
        throw new Error(errors.SQLiteUpdateForeignKeys);
      const { table, name } = operation;
      let query = db.schema.alterTable(table).dropConstraint(name);
      if (provider !== "mysql") query = query.ifExists();

      return query;
    }
  }
}

function mapForeignKeyAction(
  action: ForeignKeyAction,
  provider: SQLProvider
): OnModifyForeignAction {
  switch (action) {
    case "CASCADE":
      return "cascade";
    case "RESTRICT":
      return provider === "mssql" ? "no action" : "restrict";
    case "SET NULL":
      return "set null";
  }
}

function rawToNode(db: Kysely<any>, raw: RawBuilder<unknown>): SQLNode {
  return {
    compile() {
      return raw.compile(db);
    },
    execute() {
      return raw.execute(db);
    },
    toOperationNode() {
      return raw.toOperationNode();
    },
  };
}

function mssqlDropDefaultConstraint(tableName: string, columnName: string) {
  const alter = sql.lit(`ALTER TABLE "dbo"."${tableName}" DROP CONSTRAINT `);

  return sql`DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = ${sql.lit(tableName)} AND c.name = ${sql.lit(columnName)};

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC(${alter} + @ConstraintName);
END`;
}

function defaultValueToDB(column: AnyColumn, provider: SQLProvider) {
  const value = column.default;
  if (!value || isDefaultVirtual(column, provider)) return;

  if (value === "now") {
    return sql`CURRENT_TIMESTAMP`;
  } else if (typeof value === "object") {
    return sql.lit(value.value);
  }
}
