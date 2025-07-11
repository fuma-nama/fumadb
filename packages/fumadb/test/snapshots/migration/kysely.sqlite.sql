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

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text default 'another-avatar', constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update restrict);

INSERT INTO "_temp_users" ("id", "name", "email", "image") SELECT "id", "name", "email", "image" FROM "users";

DROP TABLE "users";

ALTER TABLE "_temp_users" RENAME TO "users";

alter table "accounts" add column "email" text not null;

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;
/* --- */
alter table "users" rename column "image" to "temp_image";

alter table "users" add column "image" text;

update "users" set "image" = "temp_image";

alter table "users" drop column "temp_image";

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text, constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete restrict on update restrict);

INSERT INTO "_temp_users" ("id", "name", "email", "image") SELECT "id", "name", "email", "image" FROM "users";

DROP TABLE "users";

ALTER TABLE "_temp_users" RENAME TO "users";

update "private_test_version" set "id" = ?, "version" = ? where "id" = ?;