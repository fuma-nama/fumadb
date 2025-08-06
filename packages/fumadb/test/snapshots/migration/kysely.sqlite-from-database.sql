create table "users" ("id" text not null primary key, "image" text default 'my-avatar', "data" blob);

create table "accounts" ("secret_id" text not null primary key);

create table "private_test_settings" ("key" text primary key, "value" text not null);

insert into "private_test_settings" ("key", "value") values ('version', '1.0.0');

insert into "private_test_settings" ("key", "value") values ('name-variants', '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"users.data":{"convex":"data","drizzle":"data","prisma":"data","mongodb":"data","sql":"data"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"}}');
/* --- */
PRAGMA foreign_keys = OFF;

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text default 'another-avatar', "string" text, "bigint" blob, "integer" integer, "decimal" real, "bool" integer, "json" text, "binary" blob, "date" integer, "timestamp" integer, "fatherId" text, constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update restrict, constraint "father_fk" foreign key ("fatherId") references "users" ("id") on delete restrict on update restrict);

create unique index "unique_c_users_email" on "_temp_users" ("email");

create unique index "unique_c_users_fatherId" on "_temp_users" ("fatherId");

INSERT INTO "_temp_users" ("id", "image") SELECT "id" as "id", "image" as "image" FROM "users";

drop table "users";

alter table "_temp_users" rename to "users";

PRAGMA foreign_keys = ON;

alter table "accounts" add column "email" text default 'test' not null;

create unique index "unique_c_accounts_email" on "accounts" ("email");

update "private_test_settings" set "value" = '2.0.0' where "key" = 'version';

update "private_test_settings" set "value" = '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.name":{"convex":"name","drizzle":"name","prisma":"name","mongodb":"name","sql":"name"},"users.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"users.stringColumn":{"convex":"stringColumn","drizzle":"stringColumn","prisma":"stringColumn","mongodb":"string","sql":"string"},"users.bigintColumn":{"convex":"bigintColumn","drizzle":"bigintColumn","prisma":"bigintColumn","mongodb":"bigint","sql":"bigint"},"users.integerColumn":{"convex":"integerColumn","drizzle":"integerColumn","prisma":"integerColumn","mongodb":"integer","sql":"integer"},"users.decimalColumn":{"convex":"decimalColumn","drizzle":"decimalColumn","prisma":"decimalColumn","mongodb":"decimal","sql":"decimal"},"users.boolColumn":{"convex":"boolColumn","drizzle":"boolColumn","prisma":"boolColumn","mongodb":"bool","sql":"bool"},"users.jsonColumn":{"convex":"jsonColumn","drizzle":"jsonColumn","prisma":"jsonColumn","mongodb":"json","sql":"json"},"users.binaryColumn":{"convex":"binaryColumn","drizzle":"binaryColumn","prisma":"binaryColumn","mongodb":"binary","sql":"binary"},"users.dateColumn":{"convex":"dateColumn","drizzle":"dateColumn","prisma":"dateColumn","mongodb":"date","sql":"date"},"users.timestampColumn":{"convex":"timestampColumn","drizzle":"timestampColumn","prisma":"timestampColumn","mongodb":"timestamp","sql":"timestamp"},"users.fatherId":{"convex":"fatherId","drizzle":"fatherId","prisma":"fatherId","mongodb":"fatherId","sql":"fatherId"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"},"accounts.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"}}' where "key" = 'name-variants';
/* --- */
PRAGMA foreign_keys = OFF;

drop index if exists "unique_c_users_email";

drop index if exists "unique_c_users_fatherId";

create table "_temp_users" ("id" text not null primary key, "name" text not null, "email" text not null, "image" text);

INSERT INTO "_temp_users" ("id", "name", "email", "image") SELECT "id" as "id", "name" as "name", "email" as "email", "image" as "image" FROM "users";

drop table "users";

alter table "_temp_users" rename to "users";

PRAGMA foreign_keys = ON;

PRAGMA foreign_keys = OFF;

drop index if exists "unique_c_accounts_email";

create table "_temp_accounts" ("secret_id" text not null primary key, "email" text not null);

INSERT INTO "_temp_accounts" ("secret_id", "email") SELECT "secret_id" as "secret_id", "email" as "email" FROM "accounts";

drop table "accounts";

alter table "_temp_accounts" rename to "accounts";

PRAGMA foreign_keys = ON;

update "private_test_settings" set "value" = '3.0.0' where "key" = 'version';

update "private_test_settings" set "value" = '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.name":{"convex":"name","drizzle":"name","prisma":"name","mongodb":"name","sql":"name"},"users.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"},"accounts.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"}}' where "key" = 'name-variants';