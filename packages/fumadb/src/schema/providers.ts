export const providers = [
  "sqlite",
  "cockroachdb",
  "mysql",
  "postgresql",
  "mssql",
  "mongodb",
] as const;

export type Provider = (typeof providers)[number];
