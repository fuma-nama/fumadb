create table "users" ("id" text not null primary key, "image" text default 'my-avatar', "data" blob);

create table "accounts" ("secret_id" text not null primary key);

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
alter table "users" add column "name" text not null;

alter table "users" add column "email" text not null;

alter table "users" rename column "image" to "temp_image";

alter table "users" add column "image" text default 'another-avatar';

update "users" set "image" = "temp_image";

alter table "users" drop column "temp_image";

alter table "accounts" add column "email" text not null;

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;