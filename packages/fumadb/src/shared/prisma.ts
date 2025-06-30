export type PrismaClient = Record<
  string,
  {
    create: (options: {
      data: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;

    createMany: (options: { data: Record<string, unknown>[] }) => Promise<void>;

    delete: (options: { where: object }) => Promise<Record<string, unknown>>;

    deleteMany: (options: { where?: object }) => Promise<void>;

    findFirst: (options: {
      where: object;
      select?: Record<string, boolean>;
      orderBy?: OrderBy | OrderBy[];
      skip?: number;
    }) => Promise<Record<string, unknown> | null>;

    findMany: (options: {
      where?: object;
      select?: Record<string, boolean>;
      orderBy?: OrderBy | OrderBy[];
      skip?: number;
      take?: number;
    }) => Promise<Record<string, unknown>[]>;

    updateMany: (options: {
      where?: object;
      data: Record<string, unknown>;
    }) => Promise<void>;
  }
>;

export type OrderBy = {
  [k: string]: "asc" | "desc" | OrderBy;
};
