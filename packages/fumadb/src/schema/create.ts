import type { Awaitable, MigrationContext } from "./migrate";
import type { MigrationOperation } from "./migrate/shared";

export type AnySchema = Schema<Record<string, AnyTable>>;

export type AnyRelation = Relation;

export type AnyTable = Table;

export type AnyColumn =
  | Column<keyof TypeMap, unknown, unknown>
  | IdColumn<IdColumnType, unknown, unknown>;

export type ForeignKeyAction = "RESTRICT" | "CASCADE" | "SET NULL";

interface ForeignKeyConfig {
  onUpdate: ForeignKeyAction;
  onDelete: ForeignKeyAction;
}

export class Relation<
  Type extends RelationType = RelationType,
  T extends AnyTable = AnyTable,
  Implied extends boolean = boolean
> {
  ormName: string = "";
  type: Type;

  table: T;
  referencer: AnyTable;
  foreignKeyConfig?: ForeignKeyConfig;
  private implied: Implied;

  impliedBy?: AnyRelation;
  implying?: AnyRelation;

  on: [string, string][];
  constructor(
    type: Type,
    referencer: AnyTable,
    table: T,
    on: [string, string][]
  ) {
    this.type = type;
    this.table = table;
    this.on = on;
    this.referencer = referencer;
    this.implied = (on.length === 0) as Implied;
  }

  /**
   * Define foreign key for explicit relation, please note that:
   *
   * - this constraint is ignored for MongoDB (without Prisma).
   * - you **must** define foreign key for explicit relations, due to the limitations of Prisma.
   */
  foreignKey(
    config: ForeignKeyConfig = { onDelete: "RESTRICT", onUpdate: "RESTRICT" }
  ): Implied extends true ? never : this {
    if (this.implied)
      throw new Error("You cannot call `foreignKey()` on implied relations.");
    this.foreignKeyConfig = config;

    return this as any;
  }

  /**
   * When length  of `on` is zero (no fields/references), it's an implied relation from another relation.
   */
  isImplied(): Implied {
    return this.implied;
  }
}

export interface Schema<
  Tables extends Record<string, AnyTable> = Record<string, AnyTable>
> {
  version: string;
  tables: Tables;

  up?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
  down?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
}

export interface Table<
  Columns extends Record<string, AnyColumn> = Record<string, AnyColumn>,
  Relations extends Record<string, AnyRelation> = Record<string, AnyRelation>,
  Id extends string = string
> {
  name: Id;
  ormName: string;

  columns: Columns;
  relations: Relations;
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
  date: Date;
  timestamp: Date;
} & Record<`varchar(${number})`, string>;

type DefaultValue<T extends keyof TypeMap> =
  | {
      sql: string;
    }
  | {
      value: TypeMap[T];
    }
  | "auto"
  | (T extends keyof DefaultMap ? DefaultMap[T] : never);

export class Column<Type extends keyof TypeMap, In = unknown, Out = unknown> {
  name: string;
  type: Type;
  nullable: boolean;
  ormName: string = "";

  constructor(name: string, type: Type, nullable: boolean) {
    this.name = name;
    this.type = type;
    this.nullable = nullable;
  }

  default?: DefaultValue<Type>;
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
  Out = unknown
> extends Column<Type, In, Out> {
  constructor(name: string, type: Type) {
    super(name, type, false);
  }
}

type ApplyNullable<Type, Nullable extends boolean> = Nullable extends true
  ? Type | null
  : Type;

export function column<
  Type extends keyof TypeMap,
  Nullable extends boolean = false,
  Default extends DefaultValue<Type> | undefined = undefined
>(
  name: string,
  type: Type,
  options?: {
    /**
     * @default false
     */
    nullable?: Nullable;
    default?: Default;
  }
): Column<
  Type,
  ApplyNullable<
    ApplyNullable<TypeMap[Type], Nullable>,
    Default extends undefined ? false : true
  >,
  ApplyNullable<TypeMap[Type], Nullable>
> {
  const column = new Column(name, type, (options?.nullable ?? false) as any);
  column.default = options?.default;

  return column as any;
}

export function idColumn<
  Type extends IdColumnType,
  Default extends DefaultValue<Type> | undefined = undefined
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

interface RelationBuilder<Columns extends Record<string, AnyColumn>> {
  one<Target extends AnyTable>(another: Target): Relation<"one", Target, true>;

  one<Target extends AnyTable>(
    another: Target,
    ...on: [keyof Columns, keyof Target["columns"]][]
  ): Relation<"one", Target, false>;

  many<Target extends AnyTable>(
    another: Target
  ): Relation<"many", Target, true>;
}

function relationBuilder(
  referencer: AnyTable
): RelationBuilder<Record<string, AnyColumn>> {
  return {
    one(another, ...on) {
      return new Relation(
        "one",
        referencer,
        another,
        on as [string, string][]
      ) as any;
    },
    many(another) {
      return new Relation("many", referencer, another, []);
    },
  };
}

export function table<
  Id extends string,
  Columns extends Record<string, AnyColumn>
>(name: Id, columns: Columns): Table<Columns, {}, Id> {
  const table: Table<Columns, {}, Id> = {
    ormName: "",
    name,
    columns,
    relations: {},
  };

  for (const k in table.columns) {
    table.columns[k]!.ormName = k;
  }

  return table;
}

type CreateSchemaTables<
  Tables extends Record<string, AnyTable>,
  RelationsMap extends {
    [K in keyof Tables]?: RelationFn<Tables[K]>;
  }
> = {
  [K in keyof Tables]: Tables[K] extends Table<infer Columns, any, infer Id>
    ? Table<
        Columns,
        RelationsMap[K] extends RelationFn<Tables[K]>
          ? {
              [R in keyof ReturnType<RelationsMap[K]>]: ReturnType<
                RelationsMap[K]
              >[R] extends Relation<
                infer Type,
                Table<any, any, infer $Id>,
                infer Implied
              >
                ? Relation<
                    Type,
                    Extract<
                      CreateSchemaTables<Tables, RelationsMap>[keyof Tables],
                      Table<any, any, $Id>
                    >,
                    Implied
                  >
                : never;
            }
          : {},
        Id
      >
    : never;
};

type RelationFn<From extends AnyTable> = (
  builder: RelationBuilder<From["columns"]>
) => Record<string, AnyRelation>;

export function schema<
  Tables extends Record<string, AnyTable>,
  RelationsMap extends {
    [K in keyof Tables]?: RelationFn<Tables[K]>;
  }
>(
  config: Schema<Tables> & {
    relations?: RelationsMap;
  }
): Schema<CreateSchemaTables<Tables, RelationsMap>> {
  const { tables, relations: relationsMap = {} as RelationsMap } = config;
  const impliedRelations: AnyRelation[] = [];

  for (const k in tables) {
    const table = tables[k];
    if (table) table.ormName = k;
  }

  for (const k in relationsMap) {
    const relationFn = relationsMap[k];
    if (!relationFn || !tables[k]) continue;

    const relations = relationFn(relationBuilder(tables[k]));
    for (const name in relations) {
      const relation = relations[name];
      if (!relation) continue;

      relation.ormName = name;
      if (relation.isImplied()) {
        impliedRelations.push(relation);
        continue;
      }

      if (!relation.foreignKeyConfig) {
        throw new Error(
          "You must define foreign key for explicit relations due the limitations of Prisma."
        );
      }
    }

    tables[k].relations = relations;
  }

  for (const implied of impliedRelations) {
    const sourceTable = implied.table;

    for (const k in sourceTable.relations) {
      const relation = sourceTable.relations[k];
      if (!relation || relation.isImplied()) continue;

      if (relation.table === implied.referencer) {
        implied.on = relation.on.map(([left, right]) => [right, left]);
        implied.impliedBy = relation;
        relation.implying = implied;

        break;
      }
    }

    if (implied.on.length === 0)
      throw new Error(
        `Cannot resolve implied relation ${implied.ormName} in table "${implied.referencer.ormName}"`
      );
  }

  return config as any;
}
