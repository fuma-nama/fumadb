create table "users" ("id" varchar(255) not null primary key, "image" varchar(200) default 'my-avatar', "data" bytea);

create table "accounts" ("secret_id" varchar(255) not null primary key);

update "private_test_version" set "id" = $1, "version" = $2 where "id" = $3;
/* --- */
alter table "users" add column "name" varchar(255) not null;

alter table "users" add column "email" varchar(255) not null;

alter table "users" alter column "image" set default 'another-avatar';

alter table "users" add constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update restrict;

alter table "accounts" add column "email" varchar(255) not null;

update "private_test_version" set "id" = $1, "version" = $2 where "id" = $3;
/* --- */
alter table "users" alter column "image" drop default;

alter table "users" drop constraint "account_fk";

alter table "users" add constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete restrict on update restrict;

update "private_test_version" set "id" = $1, "version" = $2 where "id" = $3;