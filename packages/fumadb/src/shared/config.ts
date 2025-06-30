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
