create table "users" ("id" integer generated always as identity not null primary key, "image" varchar(200) default 'my-avatar');

create table "accounts" ("secret_id" varchar(255) not null);
/* --- */
alter table "users" add column "name" varchar(255) not null, add column "email" varchar(255) not null, alter column "image" set default 'my-avatar';

alter table "accounts" add column "email" varchar(255) not null;