create table "users" ("id" varchar(255) not null primary key, "image" varchar(200) default 'my-avatar', "data" varbinary(max));

create table "accounts" ("secret_id" varchar(255) not null primary key);

update "private_test_version" set "id" = @1, "version" = @2 where "id" = @3;
/* --- */
alter table "users" add "name" varchar(255) not null;

alter table "users" add "email" varchar(255) not null;

alter table "users" drop column "data";

alter table "users" add constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update no action;

alter table "accounts" add "email" varchar(255) not null;

alter table "accounts" add constraint "unique_c_accounts_email" unique ("email");

update "private_test_version" set "id" = @1, "version" = @2 where "id" = @3;
/* --- */
DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = @1 AND c.name = @2;

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC(@3 + @ConstraintName);
END;

alter table "users" add constraint "unique_c_users_email" unique ("email");

DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = @1 AND c.name = @2;

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC(@3 + @ConstraintName);
END;

alter table "users" alter column "image" varchar(max);

alter table "users" drop constraint "account_fk";

alter table "users" add constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete no action on update no action;

DECLARE @ConstraintName NVARCHAR(200);

SELECT @ConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = 'dbo' AND t.name = @1 AND c.name = @2;

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC(@3 + @ConstraintName);
END;

alter table "accounts" drop constraint "unique_c_accounts_email";

update "private_test_version" set "id" = @1, "version" = @2 where "id" = @3;