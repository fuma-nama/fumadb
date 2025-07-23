import {
  ColumnBuilderCallback,
  CreateTableBuilder,
  Kysely,
  OnModifyForeignAction,
  RawBuilder,
  sql,
} from "kysely";
import { ColumnOperation, MigrationOperation, SQLNode } from "./shared";
import { SQLProvider } from "../../shared/providers";
import { AnyColumn, AnyTable, ForeignKeyAction, IdColumn } from "../create";
import { schemaToDBType, defaultValueToDB } from "../serialize";

interface ExecuteConfig {
  db: Kysely<any>;
  provider: SQLProvider;
}

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
    .column(col.name)
    .unique();

  if (provider === "mssql") {
    // ignore null by default
    return query.where(col.getSQLName(tableName), "is not", null);
  }

  return query;
}

function executeColumn(
  tableName: string,
  operation: ColumnOperation,
  config: ExecuteConfig
): SQLNode[] {
  const { db, provider } = config;
  const next = () => db.schema.alterTable(tableName);
  const results: SQLNode[] = [];

  function registryUniqueColumn(col: AnyColumn) {
    if (provider === "sqlite") {
      results.push(createUniqueIndex(db, tableName, col, provider));
      return;
    }

    results.push(
      next().addUniqueConstraint(col.getUniqueConstraintName(), [col.name])
    );
  }

  function deregisterUniqueColumn(col: AnyColumn) {
    // Cockroach DB needs to drop the index instead
    if (provider === "cockroachdb" || provider === "sqlite") {
      let query = db.schema.dropIndex(col.getUniqueConstraintName());
      if (provider === "cockroachdb") query = query.cascade();

      results.push(query);
      return;
    }

    results.push(next().dropConstraint(col.getUniqueConstraintName()));
  }

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
          col.name,
          sql.raw(schemaToDBType(col, provider)),
          getColumnBuilderCallback(col, provider)
        )
      );

      if (col.unique) registryUniqueColumn(col);
      return results;
    }
    case "update-column":
      const col = operation.value;

      if (col instanceof IdColumn) throw new Error(errors.IdColumnUpdate);
      if (provider === "sqlite") {
        throw new Error(
          "SQLite doesn't support updating column, recreate the table instead."
        );
      }

      if (
        !operation.updateDataType &&
        !operation.updateDefault &&
        !operation.updateNullable &&
        !operation.updateUnique
      )
        return results;

      function onUpdateUnique() {
        if (col.unique) {
          registryUniqueColumn(col);
        } else {
          deregisterUniqueColumn(col);
        }
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
          rawToNode(db, mssqlDropDefaultConstraint(tableName, col.name))
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
          const name = `DF_${tableName}_${col.name}`;

          results.push(
            rawToNode(
              db,
              sql`ALTER TABLE ${sql.ref(tableName)} ADD CONSTRAINT ${sql.ref(name)} DEFAULT ${defaultValue} FOR ${sql.ref(col.name)}`
            )
          );
        }
      }

      if (operation.updateUnique) onUpdateUnique();
      return results;
  }
}

export function execute(
  operation: MigrationOperation,
  config: ExecuteConfig
): SQLNode | SQLNode[] {
  const { db, provider } = config;

  function createTable(table: AnyTable) {
    const results: SQLNode[] = [];
    let builder = db.schema.createTable(table.name) as CreateTableBuilder<
      string,
      string
    >;

    for (const col of Object.values(table.columns)) {
      builder = builder.addColumn(
        col.name,
        sql.raw(schemaToDBType(col, provider)),
        getColumnBuilderCallback(col, provider)
      );

      if (col.unique && provider === "sqlite") {
        results.push(createUniqueIndex(db, table.name, col, provider));
      } else if (col.unique) {
        builder = builder.addUniqueConstraint(col.getUniqueConstraintName(), [
          col.name,
        ]);
      }
    }

    for (const foreignKey of table.foreignKeys) {
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
    case "update-table":
      const results: SQLNode[] = [];

      for (const op of operation.value) {
        const res = executeColumn(operation.name, op, config);

        if (Array.isArray(res)) results.push(...res);
        else results.push(res);
      }

      return results;
    case "drop-table":
      return db.schema.dropTable(operation.name);
    case "kysely-builder":
      return operation.value(db);
    case "sql":
      return rawToNode(db, sql.raw(operation.sql));
    case "recreate-table":
      const table = operation.value;
      const tempName = `_temp_${table.name}`;
      let result = execute(
        {
          type: "create-table",
          value: { ...table, name: tempName },
        },
        config
      );
      if (!Array.isArray(result)) result = [result];

      const colNames = Object.values(table.columns)
        .map((col) => `"${col.name}"`)
        .join(", ");

      result.push(
        rawToNode(
          db,
          sql.raw(
            `INSERT INTO "${tempName}" (${colNames}) SELECT ${colNames} FROM "${table.name}"`
          )
        )
      );
      result.push(
        db.schema.dropTable(table.name),
        db.schema.alterTable(tempName).renameTo(table.name)
      );

      return result;
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

      return db.schema.alterTable(table).dropConstraint(name);
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
  return sql`DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = ${tableName} AND c.name = ${columnName};

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC(${`ALTER TABLE dbo.${tableName} DROP CONSTRAINT `} + @ConstraintName);
END`;
}
