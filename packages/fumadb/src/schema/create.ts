import { createId } from "../cuid";
import type { CustomMigrationFn } from "../migration-engine/create";
import type { ForeignKeyInfo } from "../migration-engine/shared";
import { validateSchema } from "./validate";

export type AnySchema = Schema<string, Record<string, AnyTable>>;

export type AnyRelation = Relation;

export type AnyTable = Table;

export type AnyColumn =
  | Column<keyof TypeMap, unknown, unknown>
  | IdColumn<IdColumnType, unknown, unknown>;

export type ForeignKeyAction = "RESTRICT" | "CASCADE" | "SET NULL";

export interface NameVariants {
  sql: string;
  drizzle: string;
  prisma: string;
  convex: string;
  mongodb: string;
}

export interface ForeignKey {
  name: string;
  table: AnyTable;
  columns: AnyColumn[];

  referencedTable: AnyTable;
  referencedColumns: AnyColumn[];
  onUpdate: ForeignKeyAction;
  onDelete: ForeignKeyAction;
  /**
   * Translate to raw DB names
   */
  compile: () => ForeignKeyInfo;
}

class RelationInit<
  Type extends RelationType,
  Tables extends Record<string, AnyTable>,
  T extends keyof Tables,
> {
  type: Type;
  referencedTable: Tables[T];
  referencer: AnyTable;

  constructor(type: Type, referencedTable: Tables[T], referencer: AnyTable) {
    this.type = type;
    this.referencedTable = referencedTable;
    this.referencer = referencer;
  }
}

export class ImplicitRelationInit<
  Type extends RelationType,
  Tables extends Record<string, AnyTable>,
  T extends keyof Tables,
> extends RelationInit<Type, Tables, T> {
  init(ormName: string, impliedBy: ExplicitRelation) {
    const output: ImplicitRelation<Type, Tables[T]> = {
      id: impliedBy.id,
      on: impliedBy.on.map(([left, right]) => [right, left]),
      type: this.type,
      table: this.referencedTable,
      implied: true,
      impliedBy,
      name: ormName,
      referencer: this.referencer,
    };

    impliedBy.implying = output;
    return output;
  }
}

interface ForeignKeyConfig {
  name: string;
  onUpdate: ForeignKeyAction;
  onDelete: ForeignKeyAction;
}

export class ExplicitRelationInit<
  Type extends RelationType,
  Tables extends Record<string, AnyTable>,
  T extends keyof Tables,
> extends RelationInit<Type, Tables, T> {
  private foreignKeyConfig?: Partial<ForeignKeyConfig>;
  implyingRelationName?: string;
  on: [string, string][] = [];

  imply(implyingRelationName: string) {
    this.implyingRelationName = implyingRelationName;
    return this;
  }

  private initForeignKey(ormName: string): ForeignKey | undefined {
    const config = this.foreignKeyConfig;
    if (!config) return;

    const columns: AnyColumn[] = [];
    const referencedColumns: AnyColumn[] = [];

    for (const [left, right] of this.on) {
      columns.push(this.referencer.columns[left]);
      referencedColumns.push(this.referencedTable.columns[right]);
    }

    return {
      columns,
      referencedColumns,
      referencedTable: this.referencedTable,
      table: this.referencer,
      name: config.name ?? `${ormName}_fk`,
      onDelete: config.onDelete ?? "RESTRICT",
      onUpdate: config.onUpdate ?? "RESTRICT",
      compile() {
        return {
          name: this.name,
          onUpdate: this.onUpdate,
          onDelete: this.onDelete,
          table: this.table.names.sql,
          referencedTable: this.referencedTable.names.sql,
          referencedColumns: this.referencedColumns.map((col) => col.names.sql),
          columns: this.columns.map((col) => col.names.sql),
        };
      },
    };
  }

  init(ormName: string): ExplicitRelation<Type, Tables[T]> {
    let id = `${this.referencer.ormName}_${this.referencedTable.ormName}`;
    if (this.implyingRelationName) id += `_${this.implyingRelationName}`;

    return {
      id,
      implied: false,
      foreignKey: this.initForeignKey(ormName),
      implying: undefined,
      on: this.on,
      name: ormName,
      referencer: this.referencer,
      table: this.referencedTable,
      type: this.type,
    };
  }

  /**
   * Define foreign key for explicit relation, please note that:
   *
   * - this constraint is ignored for MongoDB (without Prisma).
   * - you **must** define foreign key for explicit relations, due to the limitations of Prisma.
   */
  foreignKey(config: Partial<ForeignKeyConfig> = {}) {
    this.foreignKeyConfig = config;
    return this;
  }
}

interface BaseRelation<
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
> {
  /**
   * The relation id shared between implied/implying relation
   */
  id: string;
  name: string;
  type: Type;

  table: T;
  referencer: AnyTable;

  on: [string, string][];
}

export interface ImplicitRelation<
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
> extends BaseRelation<Type, T> {
  implied: true;
  readonly impliedBy: ExplicitRelation;
}

export interface ExplicitRelation<
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
> extends BaseRelation<Type, T> {
  implied: false;
  implying: ImplicitRelation | undefined;
  foreignKey?: ForeignKey;
}

export type Relation<
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
> = ImplicitRelation<Type, T> | ExplicitRelation<Type, T>;

export interface Table<
  Columns extends Record<string, AnyColumn> = Record<string, AnyColumn>,
  Relations extends Record<string, AnyRelation> = Record<string, AnyRelation>,
> {
  names: NameVariants;
  ormName: string;

  columns: Columns;
  relations: Relations;
  foreignKeys: ForeignKey[];
  /**
   * @param name - name
   * @param type - default to "sql"
   */
  getColumnByName: (
    name: string,
    type?: keyof NameVariants
  ) => AnyColumn | undefined;
  getIdColumn: () => AnyColumn;
}

type DefaultMap = {
  date: "now";
  timestamp: "now";
};

type IdColumnType = `varchar(${number})`;

export type TypeMap = {
  string: string;
  bigint: bigint;
  integer: number;
  decimal: number;
  bool: boolean;
  json: unknown;
  /**
   * this follows the same specs as Prisma `Bytes` for consistency.
   */
  binary: Uint8Array;
  date: Date;
  timestamp: Date;
} & Record<`varchar(${number})`, string>;

export type DefaultValue<T extends keyof TypeMap = keyof TypeMap> =
  | {
      value: TypeMap[T];
    }
  | "auto"
  | (T extends keyof DefaultMap ? DefaultMap[T] : never);

export class Column<Type extends keyof TypeMap, In = unknown, Out = unknown> {
  names: NameVariants;
  type: Type;
  ormName: string = "";
  nullable: boolean = false;
  unique: boolean = false;
  default?: DefaultValue<Type>;
  /**
   * @internal
   */
  _table?: AnyTable;

  constructor(names: Partial<NameVariants>, type: Type) {
    this.names = nameVariants(names, () => this.ormName);
    this.type = type;
  }

  clone() {
    const clone = new Column(this.names, this.type);
    clone.ormName = this.ormName;
    clone.nullable = this.nullable;
    clone.unique = this.unique;
    clone.default = this.default;
    clone._table = this._table;
    return clone;
  }

  getUniqueConstraintName(tableName = this._table?.ormName): string {
    return `unique_c_${tableName}_${this.ormName}`;
  }

  /**
   * Generate default value for the column on runtime.
   */
  generateDefaultValue(): unknown | undefined {
    if (!this.default) return;

    if (this.default === "auto") return createId();
    if (this.default === "now") return new Date(Date.now());
    if ("value" in this.default) return this.default.value;
  }

  get $in(): In {
    throw new Error("Type inference only");
  }
  get $out(): Out {
    throw new Error("Type inference only");
  }
}

export class IdColumn<
  Type extends IdColumnType = IdColumnType,
  In = unknown,
  Out = unknown,
> extends Column<Type, In, Out> {
  id = true;

  constructor(names: Partial<NameVariants>, type: Type) {
    super(names, type);
    this.names.mongodb = "_id";
  }
}

type ColumnTypeSupportingDefault =
  | "string"
  | "bigint"
  | "integer"
  | "decimal"
  | "bool"
  | "date"
  | "timestamp"
  | `varchar(${number})`;

type ApplyNullable<Type, Nullable extends boolean> = Nullable extends true
  ? Type | null
  : Type;

interface BasesColumnOptions<
  Type extends keyof TypeMap,
  Default extends DefaultValue<Type> | undefined,
> {
  default?: Type extends ColumnTypeSupportingDefault ? Default : never;
}

export function column<
  Type extends keyof TypeMap,
  Nullable extends boolean = false,
  Default extends DefaultValue<Type> | undefined = undefined,
>(
  name: string | Partial<NameVariants>,
  type: Type,
  options: BasesColumnOptions<Type, Default> & {
    /**
     * @default false
     */
    nullable?: Nullable;

    /**
     * Add unique constraint to the field, for consistency, duplicated null values are allowed.
     *
     * @default false
     */
    unique?: boolean;
  } = {}
): Column<
  Type,
  ApplyNullable<
    ApplyNullable<TypeMap[Type], Nullable>,
    Default extends undefined ? false : true
  >,
  ApplyNullable<TypeMap[Type], Nullable>
> {
  const column = new Column(
    typeof name === "string" ? { sql: name, mongodb: name } : name,
    type
  );
  column.nullable = options.nullable ?? false;
  column.unique = options.unique ?? false;
  column.default = options.default;

  return column as any;
}

export function idColumn<
  Type extends IdColumnType,
  Default extends DefaultValue<Type> | undefined = undefined,
>(
  name: string | Partial<NameVariants>,
  type: Type,
  options: BasesColumnOptions<Type, Default> = {}
): IdColumn<
  Type,
  Default extends undefined ? TypeMap[Type] : TypeMap[Type] | null,
  TypeMap[Type]
> {
  const column = new IdColumn(
    typeof name === "string" ? { sql: name, mongodb: name } : name,
    type
  );
  column.default = options.default;

  return column as any;
}

export type RelationType = "many" | "one";

export interface RelationBuilder<
  Tables extends Record<string, AnyTable> = Record<string, AnyTable>,
  K extends keyof Tables = keyof Tables,
> {
  one<T extends keyof Tables>(
    another: T
  ): ImplicitRelationInit<"one", Tables, T>;

  one<T extends keyof Tables>(
    another: T,
    ...on: [keyof Tables[K]["columns"], keyof Tables[T]["columns"]][]
  ): ExplicitRelationInit<"one", Tables, T>;

  many<T extends keyof Tables>(
    another: T
  ): ImplicitRelationInit<"many", Tables, T>;
}

function relationBuilder<
  Tables extends Record<string, AnyTable>,
  K extends keyof Tables,
>(tables: Tables, k: K): RelationBuilder<Tables, K> {
  const referencer = tables[k];

  return {
    one(another, ...on) {
      if (on.length > 0) {
        const init = new ExplicitRelationInit(
          "one",
          tables[another],
          referencer
        );
        init.on = on as [string, string][];
        return init;
      }

      return new ImplicitRelationInit(
        "one",
        tables[another],
        referencer
      ) as any;
    },
    many(another) {
      return new ImplicitRelationInit("many", tables[another], referencer);
    },
  };
}

export function table<Columns extends Record<string, AnyColumn>>(
  name: string | Partial<NameVariants>,
  columns: Columns
): Table<Columns, {}> {
  let idCol: AnyColumn | undefined;

  const columnValues = Object.values(columns);
  const table: Table<Columns, {}> = {
    ormName: "",
    names: nameVariants(
      typeof name === "string"
        ? {
            sql: name,
            mongodb: name,
          }
        : name,
      () => table.ormName
    ),
    columns,
    relations: {},
    foreignKeys: [],
    getColumnByName(name, type = "sql") {
      return columnValues.find((c) => c.names[type] === name);
    },
    getIdColumn() {
      return idCol!;
    },
  };

  for (const k in columns) {
    const column = columns[k];
    if (!column) {
      delete columns[k];
      continue;
    }

    column._table = table;
    column.ormName = k;
    if (column instanceof IdColumn) idCol = column;
  }

  if (idCol === undefined) {
    throw new Error(`there's no id column in your table ${name}`);
  }

  return table;
}

type BuildRelation<
  Tables extends Record<string, AnyTable>,
  RM extends RelationsMap<Tables>,
  R,
> =
  R extends ExplicitRelationInit<infer Type, Tables, infer K>
    ? ExplicitRelation<Type, CreateSchemaTables<Tables, RM>[K]>
    : R extends ImplicitRelationInit<infer Type, Tables, infer K>
      ? ImplicitRelation<Type, CreateSchemaTables<Tables, RM>[K]>
      : never;

type Override<T, O> = Omit<T, keyof O> & O;
export type RelationsMap<Tables extends Record<string, AnyTable>> = {
  [K in keyof Tables]?: (
    builder: RelationBuilder<Tables, K>
  ) => Record<string, RelationInit<RelationType, Tables, keyof Tables>>;
};

type CreateSchemaTables<
  Tables extends Record<string, AnyTable>,
  RM extends RelationsMap<Tables>,
> = {
  [K in keyof Tables]: Tables[K] extends Table<infer Columns, infer Relations>
    ? Table<
        Columns,
        RM[K] extends (builder: RelationBuilder<Tables, K>) => infer Out
          ? Override<
              Relations,
              {
                [R in keyof Out]: BuildRelation<Tables, RM, Out[R]>;
              }
            >
          : Relations
      >
    : never;
};

export interface Schema<
  Version extends string = string,
  Tables extends Record<string, AnyTable> = Record<string, AnyTable>,
> {
  /**
   * @description The version of the schema, it should be a semantic version string.
   */
  version: Version;
  tables: Tables;

  up?: CustomMigrationFn;
  down?: CustomMigrationFn;
}

export function schema<
  Version extends string,
  Tables extends Record<string, AnyTable>,
  RM extends RelationsMap<Tables>,
>(config: {
  version: Version;
  tables: Tables;

  up?: CustomMigrationFn;
  down?: CustomMigrationFn;
  relations?: RM;
}): Schema<Version, CreateSchemaTables<Tables, RM>> {
  const { tables, relations } = config;

  for (const k in tables) {
    const table = tables[k];

    if (table) table.ormName = k;
    else delete tables[k];
  }

  if (relations) buildRelations(tables, relations);
  validateSchema(config);

  return {
    ...config,
    tables: config.tables as unknown as CreateSchemaTables<Tables, RM>,
  };
}

function buildRelations<Tables extends Record<string, AnyTable>>(
  tables: Tables,
  relationsMap: RelationsMap<Tables>
) {
  const impliedRelations: {
    relationName: string;
    relation: ImplicitRelationInit<RelationType, Tables, keyof Tables>;
  }[] = [];
  const explicitRelations: {
    implicitRelationName?: string;
    relation: ExplicitRelation;
  }[] = [];

  for (const k in relationsMap) {
    const relationFn = relationsMap[k];
    if (!relationFn) continue;
    const table = tables[k];

    const relations = relationFn(relationBuilder(tables, k));
    for (const name in relations) {
      const relation = relations[name];
      if (!relation) continue;

      if (relation instanceof ImplicitRelationInit) {
        impliedRelations.push({
          relationName: name,
          relation,
        });
        continue;
      }

      if (relation instanceof ExplicitRelationInit) {
        const output = relation.init(name);

        explicitRelations.push({
          relation: output,
          implicitRelationName: relation.implyingRelationName,
        });

        table.relations[name] = output;
        if (output.foreignKey) table.foreignKeys.push(output.foreignKey);
      }
    }
  }

  for (const { relation, relationName } of impliedRelations) {
    const referencer = relation.referencer;
    const explicits = explicitRelations.filter((item) => {
      if (item.implicitRelationName) {
        return item.implicitRelationName === relationName;
      }

      return (
        item.relation.table === referencer &&
        item.relation.referencer === relation.referencedTable
      );
    });

    if (explicits.length !== 1)
      throw new Error(
        `Cannot resolve implied relation ${relationName} in table "${relation.referencer.ormName}", you may want to specify \`imply()\` on the explicit relation.`
      );

    referencer.relations[relationName] = relation.init(
      relationName,
      explicits[0].relation
    );
  }
}

type OverrideTables<
  Tables extends Record<string, AnyTable>,
  Override extends Record<string, AnyTable | boolean>,
> = Omit<Tables, keyof Override> & {
  [K in keyof Override as Override[K] extends AnyTable | true
    ? K
    : never]: Override[K] extends true
    ? K extends keyof Tables
      ? Tables[K]
      : never
    : Override[K];
};

export function variantSchema<
  Variant extends string,
  Version extends string,
  Tables extends Record<string, AnyTable>,
  $Tables extends Record<string, AnyTable | boolean>,
  RM extends RelationsMap<OverrideTables<Tables, $Tables>>,
>(
  variant: Variant,
  schema: Schema<Version, Tables>,
  override: {
    tables: $Tables;
    relations?: RM;
  }
): Schema<
  `${Version}-${Variant}`,
  CreateSchemaTables<OverrideTables<Tables, $Tables>, RM>
> {
  const tables: Record<string, AnyTable> = { ...schema.tables };

  for (const [k, v] of Object.entries(override.tables)) {
    if (v == null || v === true) continue;
    if (v === false) {
      delete tables[k];
      continue;
    }

    tables[k] = v;
  }

  if (override.relations)
    buildRelations(
      tables as OverrideTables<Tables, $Tables>,
      override.relations
    );

  return {
    ...schema,
    tables: tables as CreateSchemaTables<OverrideTables<Tables, $Tables>, RM>,
    version: `${schema.version}-${variant}`,
  };
}

function nameVariants(
  names: Partial<NameVariants>,
  fallback: () => string
): NameVariants {
  return new Proxy(names, {
    get(target, p) {
      return target[p as keyof typeof target] ?? fallback();
    },
  }) as NameVariants;
}
