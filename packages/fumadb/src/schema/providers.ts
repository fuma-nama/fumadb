export const providers = [
  "sqlite",
  "cockroachdb",
  "mysql",
  "postgresql",
  "sqlserver",
  "mongodb",
] as const;

export type Provider = (typeof providers)[number];
