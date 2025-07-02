import type { Awaitable, MigrationContext } from "./migrate";
import type { MigrationOperation } from "./migrate/shared";

export type AnySchema = Schema<Record<string, AnyTable>>;

export type AnyRelation = Relation<RelationType, AnyTable>;

export type AnyTable = Table<
  Record<string, AnyColumn>,
  Record<string, AnyRelation>
>;

export type AnyColumn =
  | Column<keyof TypeMap, unknown, unknown>
  | IdColumn<IdColumnType, unknown, unknown>;

export class Relation<Type extends RelationType, Target extends AnyTable> {
  ormName: string = "";
  type: Type;
  table: Target;

  on: [string, string][];
  constructor(type: Type, table: Target, on: [string, string][]) {
    this.type = type;
    this.table = table;
    this.on = on;
  }
}

export interface Schema<Tables extends Record<string, AnyTable>> {
  version: string;
  tables: Tables;

  up?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
  down?: (context: MigrationContext) => Awaitable<MigrationOperation[]>;
}

export interface Table<
  Columns extends Record<string, AnyColumn>,
  Relations extends Record<string, AnyRelation>
> {
  name: string;
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

export class IdColumn<Type extends IdColumnType, In, Out> extends Column<
  Type,
  In,
  Out
> {
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

interface RelationRaw<
  Type extends RelationType,
  Target extends AnyTable | "self"
> {
  type: Type;
  table: Target;

  on: [string, string][];
}

type AnyRelationRaw = RelationRaw<RelationType, AnyTable | "self">;

type BuildTable<
  Columns extends Record<string, AnyColumn>,
  Relations extends Record<string, AnyRelationRaw>
> = Table<
  Columns,
  {
    [K in keyof Relations]: Relations[K] extends RelationRaw<
      infer Type,
      infer Target
    >
      ? Relation<
          Type,
          Target extends AnyTable ? Target : BuildTable<Columns, Relations>
        >
      : never;
  }
>;

function relationBuilder(
  type: RelationType,
  table: AnyTable,
  ...on: [string, string][]
): AnyRelationRaw {
  if (on.length === 0) throw new Error("`on` must not be empty");

  return { type, table, on };
}

relationBuilder.self = (
  type: RelationType,
  ...on: [string, string][]
): AnyRelationRaw => {
  if (on.length === 0) throw new Error("`on` must not be empty");

  return { type, table: "self", on };
};

export function table<
  Columns extends Record<string, AnyColumn>,
  Relations extends Record<string, AnyRelationRaw> = {}
>(
  name: string,
  columns: Columns,
  relations?: (relation: {
    <Type extends RelationType, Another extends AnyTable>(
      type: Type,
      another: Another,
      ...on: [keyof Columns, keyof Another["columns"]][]
    ): RelationRaw<Type, Another>;

    self<Type extends RelationType>(
      type: Type,
      ...on: [keyof Columns, keyof Columns][]
    ): RelationRaw<Type, "self">;
  }) => Relations
): BuildTable<Columns, Relations> {
  const table: AnyTable = {
    ormName: "",
    name,
    columns,
    relations: {},
  };

  if (relations) {
    const rawRelations = relations(relationBuilder as any);

    for (const k in rawRelations) {
      const raw = rawRelations[k]!;
      const relation = new Relation(
        raw.type,
        raw.table === "self" ? table : raw.table,
        raw.on
      );

      relation.ormName = k;
      table.relations[k] = relation;
    }
  }

  for (const k in table.columns) {
    table.columns[k]!.ormName = k;
  }

  return table as BuildTable<Columns, Relations>;
}

export function schema<Tables extends Record<string, AnyTable>>(
  config: Schema<Tables>
): Schema<Tables> {
  for (const k in config.tables) {
    config.tables[k]!.ormName = k;
  }

  return config;
}
