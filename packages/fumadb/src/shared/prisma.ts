export type PrismaClient = Record<
  string,
  {
    /**
     * Field references, for comparing a field against another field of the same model.
     */
    fields: Record<string, unknown>;

    count: (options: {
      select: Record<string, unknown>;
      where?: object;
    }) => Promise<Record<string, number>>;

    aggregate: (options: PrismaAggregateOptions) => Promise<Record<string, any>>;
    groupBy: (
      options: PrismaAggregateOptions & {
        by: string[];
        orderBy?: object[];
        take?: number;
        skip?: number;
      },
    ) => Promise<Record<string, any>[]>;

    upsert: (options: {
      where: object;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;

    create: (options: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;

    createMany: (options: { data: Record<string, unknown>[] }) => Promise<void>;

    delete: (options: { where: object }) => Promise<Record<string, unknown>>;

    deleteMany: (options: { where?: object }) => Promise<{ count: number }>;

    findFirst: (options: {
      where: object;
      select?: Record<string, unknown>;
      orderBy?: OrderBy | OrderBy[];
      skip?: number;
    }) => Promise<Record<string, unknown> | null>;

    findMany: (options: {
      where?: object;
      select?: Record<string, unknown>;
      orderBy?: OrderBy | OrderBy[];
      skip?: number;
      take?: number;
    }) => Promise<Record<string, unknown>[]>;

    updateMany: (options: {
      where?: object;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  }
> & {
  $transaction: <T>(v: (tx: PrismaClient) => T | Promise<T>) => Promise<T>;
};

export type OrderBy = {
  [k: string]: "asc" | "desc" | OrderBy;
};

export interface PrismaAggregateOptions {
  where?: object;
  _count?: Record<string, true>;
  _sum?: Record<string, true>;
  _avg?: Record<string, true>;
  _min?: Record<string, true>;
  _max?: Record<string, true>;
}
