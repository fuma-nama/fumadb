import { Schema } from "../schema";

export interface LibraryConfig {
  namespace: string;

  /**
   * different versions of schemas (must be sorted in ascending order)
   */
  schemas: Schema[];

  /**
   * The initial version, it refers to the version of database **before** being initialized.
   *
   * You should not use this version number in your schemas.
   *
   * @defaultValue '0.0.0'
   */
  initialVersion?: string;
}

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
    }) => Promise<Record<string, unknown> | null>;

    findMany: (options: {
      where?: object;
      select?: Record<string, boolean>;
    }) => Promise<Record<string, unknown>[]>;

    updateMany: (options: {
      where?: object;
      data: Record<string, unknown>;
    }) => Promise<void>;
  }
>;
