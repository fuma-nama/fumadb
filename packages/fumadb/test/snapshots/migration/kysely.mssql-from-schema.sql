create table "users" ("id" varchar(255) not null primary key, "image" varchar(200) default 'my-avatar', "data" varbinary(max));

create table "accounts" ("secret_id" varchar(255) not null primary key);

create table "private_test_settings" ("key" varchar(255) primary key, "value" varchar(255) not null);

insert into "private_test_settings" ("key", "value") values ('version', '1.0.0');
/* --- */
alter table "users" add "name" varchar(255) not null;

alter table "users" add "email" varchar(255) not null;

create unique index "unique_c_users_email" on "users" ("email") where "users"."email" is not null;

DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = 'users' AND c.name = 'image';

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC('ALTER TABLE "dbo"."users" DROP CONSTRAINT ' + @ConstraintName);
END;

alter table "users" alter column "image" varchar(max);

ALTER TABLE "users" ADD CONSTRAINT "DF_users_image" DEFAULT 'another-avatar' FOR "image";

alter table "users" add "string" varchar(max);

alter table "users" add "bigint" bigint;

alter table "users" add "integer" int;

alter table "users" add "decimal" decimal;

alter table "users" add "bool" bit;

alter table "users" add "json" varchar(max);

alter table "users" add "binary" varbinary(max);

alter table "users" add "date" date;

alter table "users" add "timestamp" datetime;

alter table "users" add "fatherId" varchar(255);

create unique index "unique_c_users_fatherId" on "users" ("fatherId") where "users"."fatherId" is not null;

alter table "users" drop column "data";

alter table "accounts" add "email" varchar(255) default 'test' not null;

create unique index "unique_c_accounts_email" on "accounts" ("email") where "accounts"."email" is not null;

update "private_test_settings" set "value" = '2.0.0' where "key" = 'version';
/* --- */
alter table "users" drop constraint if exists "account_fk";

alter table "users" drop constraint if exists "father_fk";

drop index if exists "unique_c_users_email" on "users";

DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = 'users' AND c.name = 'image';

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC('ALTER TABLE "dbo"."users" DROP CONSTRAINT ' + @ConstraintName);
END;

alter table "users" drop column "string";

alter table "users" drop column "bigint";

alter table "users" drop column "integer";

alter table "users" drop column "decimal";

alter table "users" drop column "bool";

alter table "users" drop column "json";

alter table "users" drop column "binary";

alter table "users" drop column "date";

alter table "users" drop column "timestamp";

drop index if exists "unique_c_users_fatherId" on "users";

alter table "users" drop column "fatherId";

DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = 'accounts' AND c.name = 'email';

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC('ALTER TABLE "dbo"."accounts" DROP CONSTRAINT ' + @ConstraintName);
END;

drop index if exists "unique_c_accounts_email" on "accounts";

update "private_test_settings" set "value" = '3.0.0' where "key" = 'version';