create table "users" ("id" integer generated always as identity primary key, "name" varchar(255), "email" varchar(255), "image" varchar(200) default 'my-avatar');

create table "accounts" ("secret_id" varchar(255));