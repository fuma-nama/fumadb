create table "users" ("id" varchar(255) not null primary key, "image" varchar(200) default 'my-avatar', "data" varbinary(max));

create table "accounts" ("secret_id" varchar(255) not null primary key);

create table "private_test_settings" ("key" varchar(255) primary key, "value" varchar(max) not null);

insert into "private_test_settings" ("key", "value") values ('version', '1.0.0');

insert into "private_test_settings" ("key", "value") values ('name-variants', '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"users.data":{"convex":"data","drizzle":"data","prisma":"data","mongodb":"data","sql":"data"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"}}');
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

update "private_test_settings" set "value" = '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.name":{"convex":"name","drizzle":"name","prisma":"name","mongodb":"name","sql":"name"},"users.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"users.stringColumn":{"convex":"stringColumn","drizzle":"stringColumn","prisma":"stringColumn","mongodb":"string","sql":"string"},"users.bigintColumn":{"convex":"bigintColumn","drizzle":"bigintColumn","prisma":"bigintColumn","mongodb":"bigint","sql":"bigint"},"users.integerColumn":{"convex":"integerColumn","drizzle":"integerColumn","prisma":"integerColumn","mongodb":"integer","sql":"integer"},"users.decimalColumn":{"convex":"decimalColumn","drizzle":"decimalColumn","prisma":"decimalColumn","mongodb":"decimal","sql":"decimal"},"users.boolColumn":{"convex":"boolColumn","drizzle":"boolColumn","prisma":"boolColumn","mongodb":"bool","sql":"bool"},"users.jsonColumn":{"convex":"jsonColumn","drizzle":"jsonColumn","prisma":"jsonColumn","mongodb":"json","sql":"json"},"users.binaryColumn":{"convex":"binaryColumn","drizzle":"binaryColumn","prisma":"binaryColumn","mongodb":"binary","sql":"binary"},"users.dateColumn":{"convex":"dateColumn","drizzle":"dateColumn","prisma":"dateColumn","mongodb":"date","sql":"date"},"users.timestampColumn":{"convex":"timestampColumn","drizzle":"timestampColumn","prisma":"timestampColumn","mongodb":"timestamp","sql":"timestamp"},"users.fatherId":{"convex":"fatherId","drizzle":"fatherId","prisma":"fatherId","mongodb":"fatherId","sql":"fatherId"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"},"accounts.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"}}' where "key" = 'name-variants';
/* --- */
drop index if exists "unique_c_users_email" on "users";

alter table "users" drop column "bigint";

alter table "users" drop column "binary";

alter table "users" drop column "bool";

alter table "users" drop column "date";

alter table "users" drop column "decimal";

drop index if exists "unique_c_users_fatherId" on "users";

alter table "users" drop column "fatherId";

alter table "users" drop column "integer";

alter table "users" drop column "json";

alter table "users" drop column "string";

alter table "users" drop column "timestamp";

drop index if exists "unique_c_accounts_email" on "accounts";

update "private_test_settings" set "value" = '3.0.0' where "key" = 'version';

update "private_test_settings" set "value" = '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.name":{"convex":"name","drizzle":"name","prisma":"name","mongodb":"name","sql":"name"},"users.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"},"accounts.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"}}' where "key" = 'name-variants';