create table "users" ("id" text not null primary key, "image" text default 'my-avatar', "data" blob);

create table "accounts" ("secret_id" text not null primary key);

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
PRAGMA foreign_keys = OFF;

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text default 'another-avatar', "string" text, "bigint" blob, "integer" integer, "decimal" real, "bool" integer, "json" text, "binary" blob, "date" integer, "timestamp" integer, "fatherId" text, constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update restrict, constraint "father_fk" foreign key ("fatherId") references "users" ("id") on delete restrict on update restrict);

create unique index "unique_c_users_fatherId" on "_temp_users" ("fatherId");

INSERT INTO "_temp_users" ("id", "image") SELECT "id" as "id", "image" as "image" FROM "users";

drop table "users";

alter table "_temp_users" rename to "users";

PRAGMA foreign_keys = ON;

alter table "accounts" add column "email" text default 'test' not null;

create unique index "unique_c_accounts_email" on "accounts" ("email");

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
PRAGMA foreign_keys = OFF;

drop index if exists "unique_c_users_fatherId";

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text, constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete restrict on update restrict);

create unique index "unique_c_users_email" on "_temp_users" ("email");

INSERT INTO "_temp_users" ("id", "name", "email", "image") SELECT "id" as "id", "name" as "name", "email" as "email", "image" as "image" FROM "users";

drop table "users";

alter table "_temp_users" rename to "users";

PRAGMA foreign_keys = ON;

PRAGMA foreign_keys = OFF;

drop index if exists "unique_c_accounts_email";

create table "_temp_accounts" ("secret_id" text not null primary key, "email" text not null);

INSERT INTO "_temp_accounts" ("secret_id", "email") SELECT "secret_id" as "secret_id", "email" as "email" FROM "accounts";

drop table "accounts";

alter table "_temp_accounts" rename to "accounts";

PRAGMA foreign_keys = ON;

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;