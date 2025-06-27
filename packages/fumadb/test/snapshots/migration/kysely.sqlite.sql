create table "users" ("id" integer not null primary key autoincrement, "image" text default 'my-avatar');

create table "accounts" ("secret_id" text not null);

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
alter table "users" add column "name" text not null;

alter table "users" add column "email" text not null;

alter table "accounts" add column "email" text not null;

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;