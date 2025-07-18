create table "users" ("id" text not null primary key, "image" text default 'my-avatar', "data" blob);

create table "accounts" ("secret_id" text not null primary key);

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
alter table "users" add column "name" text not null;

alter table "users" add column "email" text not null;

alter table "users" add column "string" text;

alter table "users" add column "bigint" blob;

alter table "users" add column "integer" integer;

alter table "users" add column "decimal" real;

alter table "users" add column "bool" integer;

alter table "users" add column "json" text;

alter table "users" add column "binary" blob;

alter table "users" add column "date" integer;

alter table "users" add column "timestamp" integer;

alter table "users" add column "fatherId" text;

create unique index "unique_c_users_fatherId" on "users" ("fatherId");

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text default 'another-avatar', "string" text, "bigint" blob, "integer" integer, "decimal" real, "bool" integer, "json" text, "binary" blob, "date" integer, "timestamp" integer, "fatherId" text, constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update restrict, constraint "father_fk" foreign key ("fatherId") references "users" ("id") on delete restrict on update restrict);

INSERT INTO "_temp_users" ("id", "name", "email", "image", "string", "bigint", "integer", "decimal", "bool", "json", "binary", "date", "timestamp", "fatherId") SELECT "id", "name", "email", "image", "string", "bigint", "integer", "decimal", "bool", "json", "binary", "date", "timestamp", "fatherId" FROM "users";

drop table "users";

alter table "_temp_users" rename to "users";

alter table "accounts" add column "email" text not null;

create unique index "unique_c_accounts_email" on "accounts" ("email");

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text, constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete restrict on update restrict);

INSERT INTO "_temp_users" ("id", "name", "email", "image") SELECT "id", "name", "email", "image" FROM "users";

drop table "users";

alter table "_temp_users" rename to "users";

create table "_temp_accounts" ("secret_id" text not null primary key, "email" text not null);

INSERT INTO "_temp_accounts" ("secret_id", "email") SELECT "secret_id", "email" FROM "accounts";

drop table "accounts";

alter table "_temp_accounts" rename to "accounts";

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;