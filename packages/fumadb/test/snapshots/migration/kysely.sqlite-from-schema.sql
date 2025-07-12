create table "users" ("id" text not null primary key, "image" text default 'my-avatar', "data" blob);

create table "accounts" ("secret_id" text not null primary key);

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
alter table "users" add column "name" text not null;

alter table "users" add column "email" text not null;

alter table "users" drop column "data";

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text default 'another-avatar', constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update restrict);

INSERT INTO "_temp_users" ("id", "name", "email", "image") SELECT "id", "name", "email", "image" FROM "users";

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