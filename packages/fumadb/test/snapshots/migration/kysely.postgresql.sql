create table "users" ("id" varchar(255) not null primary key, "image" varchar(200) default 'my-avatar');

create table "accounts" ("secret_id" varchar(255) not null primary key);

update "private_test_version" set "id" = $1, "version" = $2 where "id" = $3;
/* --- */
alter table "users" add column "name" varchar(255) not null, add column "email" varchar(255) not null;

alter table "accounts" add column "email" varchar(255) not null;

update "private_test_version" set "id" = $1, "version" = $2 where "id" = $3;