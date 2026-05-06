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
  type ColumnOperation,
  type CustomOperation,
  isUpdated,
  type MigrationOperation,
} from "../../../migration-engine/shared";
import {
  type AnyColumn,
  type AnyTable,
  compileForeignKey,
  type ForeignKeyAction,
  IdColumn,
} from "../../../schema/create";
import { schemaToDBType } from "../../../schema/serialize";
import type { KyselyConfig } from "../../../shared/config";
import type { SQLProvider } from "../../../shared/providers";

export type ExecuteNode = Compilable & {
  execute(): Promise<any>;
};

function qualifyTable(tableName: string, schemaName?: string) {
  if (!schemaName || tableName.includes(".")) return tableName;

  // We don't need to qualify the table name here because the builder
  // is already scoped with withSchema(schemaName)
  return tableName;
}

function qualifyConstraint(constraintName: string, schemaName?: string) {
  if (!schemaName || constraintName.startsWith(schemaName))
    return constraintName;

  // We qualify the constraint name with the schema name to avoid name
  // collisions in databases where constraint names are global or per-schema.
  return `${schemaName}_${constraintName}`;
}

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
  name: string,
  tableName: string,
  cols: string[],
  provider: SQLProvider,
  schemaName?: string
) {
  let schema = db.schema;
  if (schemaName) schema = schema.withSchema(schemaName);

  const query = schema.createIndex(name).on(tableName).columns(cols).unique();

  if (provider === "mssql") {
    // ignore null by default
    return query.where((b) => {
      return b.and(cols.map((col) => b(col, "is not", null)));
    });
  }

  return query;
}

function createUniqueIndexOrConstraint(
  db: Kysely<any>,
  name: string,
  tableName: string,
  cols: string[],
  provider: SQLProvider,
  schemaName?: string
) {
  if (provider === "sqlite" || provider === "mssql") {
    return createUniqueIndex(db, name, tableName, cols, provider, schemaName);
  }

  let schema = db.schema;
  if (schemaName && !tableName.includes(".")) {
    schema = schema.withSchema(schemaName);
  }

  return schema.alterTable(tableName).addUniqueConstraint(name, cols);
}

function dropUniqueIndexOrConstraint(
  db: Kysely<any>,
  name: string,
  tableName: string,
  provider: SQLProvider,
  schemaName?: string
) {
  // Cockroach DB needs to drop the index instead
  if (
    provider === "cockroachdb" ||
    provider === "sqlite" ||
    provider === "mssql"
  ) {
    let schema = db.schema;
    if (schemaName) schema = schema.withSchema(schemaName);

    let query = schema.dropIndex(name).ifExists();
    if (provider === "cockroachdb") query = query.cascade();
    if (provider === "mssql") {
      query = query.on(tableName);
    }

    return query;
  }

  let schema = db.schema;
  if (schemaName && !tableName.includes(".")) {
    schema = schema.withSchema(schemaName);
  }

  return schema.alterTable(tableName).dropConstraint(name);
}

function executeColumn(
  tableName: string,
  operation: ColumnOperation,
  config: KyselyConfig
): ExecuteNode[] {
  const { db, provider, schema: schemaName } = config;
  const next = () => {
    let schema = db.schema;
    if (schemaName && !tableName.includes(".")) {
      schema = schema.withSchema(schemaName);
    }
    return schema.alterTable(tableName);
  };
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

      if (provider === "mysql") {
        results.push(
          next().modifyColumn(
            operation.name,
            sql.raw(schemaToDBType(col, provider)),
            getColumnBuilderCallback(col, provider)
          )
        );
        return results;
      }

      const mssqlRecreateDefaultConstraint =
        operation.updateDataType || operation.updateDefault;

      if (provider === "mssql" && mssqlRecreateDefaultConstraint) {
        results.push(
          rawToNode(
            db,
            mssqlDropDefaultConstraint(
              tableName,
              col.names.sql,
              schemaName ?? "dbo"
            )
          )
        );
      }

      if (operation.updateDataType) {
        const dbType = sql.raw(schemaToDBType(col, provider));
        const tableRef = schemaName ? `${schemaName}.${tableName}` : tableName;

        results.push(
          provider === "postgresql" || provider === "cockroachdb"
            ? rawToNode(
                db,
                sql`ALTER TABLE ${sql.ref(tableRef)} ALTER COLUMN ${sql.ref(operation.name)} TYPE ${dbType} USING (${sql.ref(operation.name)}::${dbType})`
              )
            : next().alterColumn(operation.name, (b) => b.setDataType(dbType))
        );
      }

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
          const name = qualifyConstraint(
            `DF_${tableName}_${col.names.sql}`,
            schemaName
          );
          const tableRef = schemaName
            ? `${schemaName}.${tableName}`
            : tableName;

          results.push(
            rawToNode(
              db,
              sql`ALTER TABLE ${sql.ref(tableRef)} ADD CONSTRAINT ${sql.ref(name)} DEFAULT ${defaultValue} FOR ${sql.ref(col.names.sql)}`
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
    let schema = db.schema;
    if (config.schema && !tableName.includes(".")) {
      schema = schema.withSchema(config.schema);
    }

    let builder = schema.createTable(tableName) as CreateTableBuilder<
      string,
      string
    >;

    for (const col of Object.values(table.columns)) {
      builder = builder.addColumn(
        col.names.sql,
        sql.raw(schemaToDBType(col, provider)),
        getColumnBuilderCallback(col, provider)
      );
    }

    for (const foreignKey of table.foreignKeys) {
      if (relationMode === "fumadb") break;
      const compiled = compileForeignKey(foreignKey, "sql");

      builder = builder.addForeignKeyConstraint(
        qualifyConstraint(compiled.name, config.schema),
        compiled.columns,
        qualifyTable(compiled.referencedTable, config.schema),
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

    for (const con of table.getUniqueConstraints()) {
      results.push(
        createUniqueIndexOrConstraint(
          db,
          qualifyConstraint(con.name, config.schema),
          table.names.sql,
          con.columns.map((col) => col.names.sql),
          provider,
          config.schema
        )
      );
    }

    results.unshift(builder);
    return results;
  }

  function alterTable(tableName: string) {
    let schema = db.schema;
    if (config.schema && !tableName.includes(".")) {
      schema = schema.withSchema(config.schema);
    }
    return schema.alterTable(tableName);
  }

  switch (operation.type) {
    case "create-table":
      return createTable(operation.value);
    case "rename-table":
      if (provider === "mssql") {
        const from = config.schema
          ? `${config.schema}.${operation.from}`
          : operation.from;

        return rawToNode(
          db,
          sql.raw(`EXEC sp_rename ${sql.lit(from)}, ${sql.lit(operation.to)}`)
        );
      }

      return alterTable(operation.from).renameTo(operation.to);
    case "update-table": {
      const results: ExecuteNode[] = [];

      for (const op of operation.value) {
        results.push(...executeColumn(operation.name, op, config));
      }

      return results;
    }
    case "drop-table": {
      let schema = db.schema;
      if (config.schema && !operation.name.includes(".")) {
        schema = schema.withSchema(config.schema);
      }

      return schema.dropTable(operation.name) as any;
    }
    case "custom":
      return onCustomNode(operation);
    case "add-foreign-key": {
      if (provider === "sqlite")
        throw new Error(errors.SQLiteUpdateForeignKeys);
      const { table, value } = operation;

      return alterTable(table).addForeignKeyConstraint(
        qualifyConstraint(value.name, config.schema),
        value.columns,
        qualifyTable(value.referencedTable, config.schema),
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
      let query = alterTable(table).dropConstraint(
        qualifyConstraint(name, config.schema)
      );
      if (provider !== "mysql") query = query.ifExists();

      return query;
    }
    case "add-unique-constraint":
      return createUniqueIndexOrConstraint(
        db,
        qualifyConstraint(operation.name, config.schema),
        operation.table,
        operation.columns,
        provider,
        config.schema
      );
    case "drop-unique-constraint":
      return dropUniqueIndexOrConstraint(
        db,
        qualifyConstraint(operation.name, config.schema),
        operation.table,
        provider,
        config.schema
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

function mssqlDropDefaultConstraint(
  tableName: string,
  columnName: string,
  schemaName: string = "dbo"
) {
  const alter = sql.lit(
    `ALTER TABLE "${schemaName}"."${tableName}" DROP CONSTRAINT `
  );

  return sql`DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = ${sql.lit(schemaName)} AND t.name = ${sql.lit(
    tableName
  )} AND c.name = ${sql.lit(columnName)};

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
