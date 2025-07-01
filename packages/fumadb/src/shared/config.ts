import type { AnySchema } from "../schema";

export interface LibraryConfig<Schemas extends AnySchema[] = AnySchema[]> {
  namespace: string;

  /**
   * different versions of schemas (must be sorted in ascending order)
   */
  schemas: Schemas;

  /**
   * The initial version, it refers to the version of database **before** being initialized.
   *
   * You should not use this version number in your schemas.
   *
   * @defaultValue '0.0.0'
   */
  initialVersion?: string;
}
