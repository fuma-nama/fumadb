import {
  type ColumnBuilderCallback,
  type Compilable,
  type CreateTableBuilder,
  type Kysely,
  type OnModifyForeignAction,
  type RawBuilder,
  sql,
} from "kysely";
import {
  type CustomOperation,
  isUpdated,
  type ColumnOperation,
  type MigrationOperation,
} from "../../../migration-engine/shared";
import type { SQLProvider } from "../../../shared/providers";
import {
  type AnyColumn,
  type AnyTable,
  compileForeignKey,
  type ForeignKeyAction,
  IdColumn,
} from "../../../schema/create";
import { schemaToDBType } from "../../../schema/serialize";
import type { KyselyConfig } from "../../../shared/config";
import { createId } from "../../../cuid";

export type ExecuteNode = Compilable & {
  execute(): Promise<any>;
};

function getColumnBuilderCallback(
  col: AnyColumn,
  provider: SQLProvider
): ColumnBuilderCallback {
  return (build) => {
    if (!col.isNullable) {
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
  name: string,
  provider: SQLProvider
) {
  // Cockroach DB needs to drop the index instead
  if (
    provider === "cockroachdb" ||
    provider === "sqlite" ||
    provider === "mssql"
  ) {
    let query = db.schema.dropIndex(name).ifExists();
    if (provider === "cockroachdb") query = query.cascade();
    if (provider === "mssql") query = query.on(tableName);

    return query;
  }

  return db.schema.alterTable(tableName).dropConstraint(name);
}

function executeColumn(
  tableName: string,
  operation: ColumnOperation,
  config: KyselyConfig
): ExecuteNode[] {
  const { db, provider } = config;
  const next = () => db.schema.alterTable(tableName);
  const results: ExecuteNode[] = [];

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

      if (col.isUnique)
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
          col.isUnique
            ? createUniqueIndexOrConstraint(db, tableName, col, provider)
            : dropUniqueIndexOrConstraint(
                db,
                tableName,
                col.getUniqueConstraintName(),
                provider
              )
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

      const mssqlRecreateDefaultConstraint =
        operation.updateDataType || operation.updateDefault;

      if (provider === "mssql" && mssqlRecreateDefaultConstraint) {
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
            col.isNullable ? build.dropNotNull() : build.setNotNull()
          )
        );
      }

      if (provider === "mssql" && mssqlRecreateDefaultConstraint) {
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
      } else if (provider !== "mssql" && operation.updateDefault) {
        const defaultValue = defaultValueToDB(col, provider);

        results.push(
          next().alterColumn(operation.name, (build) => {
            if (!defaultValue) return build.dropDefault();
            return build.setDefault(defaultValue);
          })
        );
      }

      if (operation.updateUnique) onUpdateUnique();
      return results;
    }
  }
}

export function execute(
  operation: MigrationOperation,
  config: KyselyConfig,
  onCustomNode: (op: CustomOperation) => ExecuteNode | ExecuteNode[]
): ExecuteNode | ExecuteNode[] {
  const {
    db,
    provider,
    relationMode = provider === "mssql" ? "fumadb" : "foreign-keys",
  } = config;

  function createTable(
    table: AnyTable,
    tableName = table.names.sql,
    sqliteDeferChecks = false
  ) {
    const results: ExecuteNode[] = [];
    let builder = db.schema.createTable(tableName) as CreateTableBuilder<
      string,
      string
    >;

    for (const col of Object.values(table.columns)) {
      builder = builder.addColumn(
        col.names.sql,
        sql.raw(schemaToDBType(col, provider)),
        getColumnBuilderCallback(col, provider)
      );

      if (col.isUnique && (provider === "sqlite" || provider === "mssql")) {
        results.push(createUniqueIndex(db, tableName, col, provider));
      } else if (col.isUnique) {
        builder = builder.addUniqueConstraint(col.getUniqueConstraintName(), [
          col.names.sql,
        ]);
      }
    }

    for (const foreignKey of table.foreignKeys) {
      if (relationMode === "fumadb") break;
      const compiled = compileForeignKey(foreignKey, "sql");

      builder = builder.addForeignKeyConstraint(
        compiled.name,
        compiled.columns,
        compiled.referencedTable,
        compiled.referencedColumns,
        (b) => {
          const builder = b
            .onUpdate(mapForeignKeyAction(compiled.onUpdate, provider))
            .onDelete(mapForeignKeyAction(compiled.onDelete, provider));

          if (sqliteDeferChecks)
            return builder.deferrable().initiallyDeferred();
          return builder;
        }
      );
    }

    results.unshift(builder);
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
      const results: ExecuteNode[] = [];

      for (const op of operation.value) {
        results.push(...executeColumn(operation.name, op, config));
      }

      return results;
    }
    case "drop-table":
      return db.schema.dropTable(operation.name);
    case "custom":
      return onCustomNode(operation);
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
    case "drop-unique-constraint":
      return dropUniqueIndexOrConstraint(
        db,
        operation.table,
        operation.name,
        provider
      );
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

function rawToNode(db: Kysely<any>, raw: RawBuilder<unknown>): ExecuteNode {
  return {
    compile() {
      return raw.compile(db);
    },
    execute() {
      return raw.execute(db);
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
  if (!value) return;
  // mysql doesn't support default value for text
  if (provider === "mysql" && column.type === "string") return;

  if ("runtime" in value && value.runtime === "now") {
    return sql`CURRENT_TIMESTAMP`;
  }

  if ("value" in value) return sql.lit(value.value);
}
