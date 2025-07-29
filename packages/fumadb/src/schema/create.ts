import { createId } from "../cuid";
import type { Awaitable, MigrationContext } from "../migration-engine/create";
import type {
  ForeignKeyInfo,
  MigrationOperation,
} from "../migration-engine/shared";
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

/**
 * foreign key info (using ORM name instead of raw DB name)
 */
export interface ForeignKey {
  name: string;
  table: string;
  columns: string[];

  referencedTable: string;
  referencedColumns: string[];
  onUpdate: ForeignKeyAction;
  onDelete: ForeignKeyAction;
  /**
   * Translate to raw DB names
   */
  compile: () => ForeignKeyInfo;
}

class RelationInit<
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
> {
  type: Type;
  table: AnyTable;
  referencer: AnyTable;

  constructor(type: Type, referencer: AnyTable, table: T) {
    this.type = type;
    this.table = table;
    this.referencer = referencer;
  }
}

export class ImplicitRelationInit<
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
> extends RelationInit<Type, T> {
  init(ormName: string, impliedBy: ExplicitRelation): ImplicitRelation {
    const output: ImplicitRelation = {
      id: impliedBy.id,
      on: impliedBy.on.map(([left, right]) => [right, left]),
      type: this.type,
      table: this.table,
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
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
> extends RelationInit<Type, T> {
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

    const columns: string[] = [];
    const referencedColumns: string[] = [];
    const table = this.referencer;
    const referencedTable = this.table;

    for (const [left, right] of this.on) {
      columns.push(left);
      referencedColumns.push(right);
    }

    return {
      columns,
      referencedColumns,
      referencedTable: referencedTable.ormName,
      table: table.ormName,
      name: config.name ?? ormName + "_fk",
      onDelete: config.onDelete ?? "RESTRICT",
      onUpdate: config.onUpdate ?? "RESTRICT",
      compile() {
        return {
          name: this.name,
          onUpdate: this.onUpdate,
          onDelete: this.onDelete,
          table: table.names.sql,
          referencedTable: referencedTable.names.sql,
          referencedColumns: referencedColumns.map(
            (col) => referencedTable.columns[col].names.sql
          ),
          columns: columns.map((col) => table.columns[col].names.sql),
        };
      },
    };
  }

  init(ormName: string): ExplicitRelation {
    const foreignKey = this.initForeignKey(ormName);
    let id = `${this.referencer.ormName}_${this.table.ormName}`;
    if (this.implyingRelationName) id += `_${this.implyingRelationName}`;

    return {
      id,
      implied: false,
      foreignKey,
      implying: undefined,
      on: this.on,
      name: ormName,
      referencer: this.referencer,
      table: this.table,
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
  Id extends string = string,
> {
  id: Id;
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
      /**
       * @deprecated Only available for SQL datgabases, don't use this
       */
      sql: string;
    }
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

  constructor(name: string, type: Type) {
    const ormName = () => this.ormName;

    this.names = nameVariants(name, ormName);
    this.type = type;
  }

  getUniqueConstraintName(tableName = this._table!.ormName): string {
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

  constructor(name: string, type: Type) {
    super(name, type);
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

export function column<
  Type extends keyof TypeMap,
  Nullable extends boolean = false,
  Default extends DefaultValue<Type> | undefined = undefined,
>(
  name: string,
  type: Type,
  options?: {
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

    default?: Type extends ColumnTypeSupportingDefault ? Default : never;
  }
): Column<
  Type,
  ApplyNullable<
    ApplyNullable<TypeMap[Type], Nullable>,
    Default extends undefined ? false : true
  >,
  ApplyNullable<TypeMap[Type], Nullable>
> {
  const column = new Column(name, type);
  column.nullable = options?.nullable ?? false;
  column.unique = options?.unique ?? false;
  column.default = options?.default;

  return column as any;
}

export function idColumn<
  Type extends IdColumnType,
  Default extends DefaultValue<Type> | undefined = undefined,
>(
  name: string,
  type: Type,
  options?: {
    default?: Default;
  }
): IdColumn<
  Type,
  Default extends undefined ? TypeMap[Type] : TypeMap[Type] | null,
  TypeMap[Type]
> {
  const column = new IdColumn(name, type);
  column.default = options?.default;

  return column as any;
}

export type RelationType = "many" | "one";

export interface RelationBuilder<
  Columns extends Record<string, AnyColumn> = Record<string, AnyColumn>,
> {
  one<Target extends AnyTable>(
    another: Target
  ): ImplicitRelationInit<"one", Target>;

  one<Target extends AnyTable>(
    another: Target,
    ...on: [keyof Columns, keyof Target["columns"]][]
  ): ExplicitRelationInit<"one", Target>;

  many<Target extends AnyTable>(
    another: Target
  ): ImplicitRelationInit<"many", Target>;
}

function relationBuilder(
  referencer: AnyTable
): RelationBuilder<Record<string, AnyColumn>> {
  return {
    one(another, ...on) {
      if (on.length > 0) {
        const init = new ExplicitRelationInit("one", referencer, another);
        init.on = on as [string, string][];
        return init;
      }

      return new ImplicitRelationInit("one", referencer, another) as any;
    },
    many(another) {
      return new ImplicitRelationInit("many", referencer, another);
    },
  };
}

export function table<
  Id extends string,
  Columns extends Record<string, AnyColumn>,
>(name: Id, columns: Columns): Table<Columns, {}, Id> {
  let idCol: AnyColumn | undefined;
  const table: Table<Columns, {}, Id> = {
    ormName: "",
    id: name,
    names: nameVariants(name, () => table.ormName),
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
    throw new Error("there's no id column in your table " + name);
  }

  const columnValues = Object.values(columns);
  return table;
}

type BuildRelation<
  Tables extends Record<string, AnyTable>,
  RelationsMap extends {
    [K in keyof Tables]?: RelationFn<Tables[K]>;
  },
  R,
> =
  R extends ExplicitRelationInit<infer Type, Table<any, any, infer $Id>>
    ? ExplicitRelation<
        Type,
        Extract<
          CreateSchemaTables<Tables, RelationsMap>[keyof Tables],
          Table<any, any, $Id>
        >
      >
    : R extends ImplicitRelationInit<infer Type, Table<any, any, infer $Id>>
      ? ImplicitRelation<
          Type,
          Extract<
            CreateSchemaTables<Tables, RelationsMap>[keyof Tables],
            Table<any, any, $Id>
          >
        >
      : never;

type CreateSchemaTables<
  Tables extends Record<string, AnyTable>,
  RelationsMap extends {
    [K in keyof Tables]?: RelationFn<Tables[K]>;
  },
> = {
  [K in keyof Tables]: Tables[K] extends Table<infer Columns, any, infer Id>
    ? Table<
        Columns,
        RelationsMap[K] extends RelationFn<Tables[K]>
          ? {
              [R in keyof ReturnType<RelationsMap[K]>]: BuildRelation<
                Tables,
                RelationsMap,
                ReturnType<RelationsMap[K]>[R]
              >;
            }
          : {},
        Id
      >
    : never;
};

export type RelationFn<From extends AnyTable = AnyTable> = (
  builder: RelationBuilder<From["columns"]>
) => Record<string, RelationInit>;

export interface Schema<
  Version extends string = string,
  Tables extends Record<string, AnyTable> = Record<string, AnyTable>,
> {
  /**
   * @description The version of the schema, it should be a semantic version string.
   */
  version: Version;
  tables: Tables;

  up?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
  down?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
}

export function schema<
  Version extends string,
  Tables extends Record<string, AnyTable>,
  RelationsMap extends {
    [K in keyof Tables]?: RelationFn<Tables[K]>;
  },
>(config: {
  version: Version;
  tables: Tables;

  up?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
  down?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
  relations?: RelationsMap;
}): Schema<Version, CreateSchemaTables<Tables, RelationsMap>> {
  const { tables, relations: relationsMap = {} as RelationsMap } = config;
  const impliedRelations: {
    relationName: string;
    relation: ImplicitRelationInit;
  }[] = [];
  // `tableName.implicitRelationName` -> explicit relation
  const explicitRelations: {
    implicitRelationName?: string;
    relation: ExplicitRelation;
  }[] = [];

  for (const k in tables) {
    const table = tables[k];

    if (table) table.ormName = k;
    else delete tables[k];
  }

  for (const k in relationsMap) {
    const relationFn = relationsMap[k];
    if (!relationFn) continue;
    const table = tables[k];

    const relations = relationFn(relationBuilder(table));
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
        item.relation.referencer === relation.table
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

  validateSchema(config);

  return {
    ...config,
    tables: config.tables as unknown as CreateSchemaTables<
      Tables,
      RelationsMap
    >,
  };
}

function nameVariants(
  name: string,
  ormNameFallback: () => string
): NameVariants {
  let internal: Partial<NameVariants> = {};

  return {
    sql: name,
    mongodb: name,
    get convex() {
      return internal.convex ?? ormNameFallback();
    },
    set convex(v) {
      internal.convex = v;
    },
    get drizzle() {
      return internal.drizzle ?? ormNameFallback();
    },
    set drizzle(v) {
      internal.drizzle = v;
    },
    get prisma() {
      return internal.prisma ?? ormNameFallback();
    },
    set prisma(v) {
      internal.prisma = v;
    },
  };
}
