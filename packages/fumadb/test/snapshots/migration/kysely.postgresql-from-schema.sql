create table "users" ("id" varchar(255) not null primary key, "image" varchar(200) default 'my-avatar', "data" bytea);

create table "accounts" ("secret_id" varchar(255) not null primary key);

create table "private_test_settings" ("key" varchar(255) primary key, "value" text not null);

insert into "private_test_settings" ("key", "value") values ('version', '1.0.0');

insert into "private_test_settings" ("key", "value") values ('name-variants', '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"users.data":{"convex":"data","drizzle":"data","prisma":"data","mongodb":"data","sql":"data"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"}}');
/* --- */
alter table "users" add column "name" varchar(255) not null;

alter table "users" add column "email" varchar(255) not null;

alter table "users" add constraint "unique_c_users_email" unique ("email");

alter table "users" alter column "image" type text;

alter table "users" alter column "image" set default 'another-avatar';

alter table "users" add column "string" text;

alter table "users" add column "bigint" bigint;

alter table "users" add column "integer" integer;

alter table "users" add column "decimal" decimal;

alter table "users" add column "bool" boolean;

alter table "users" add column "json" json;

alter table "users" add column "binary" bytea;

alter table "users" add column "date" date;

alter table "users" add column "timestamp" timestamp;

alter table "users" add column "fatherId" varchar(255);

alter table "users" add constraint "unique_c_users_fatherId" unique ("fatherId");

alter table "users" add constraint "account_fk" foreign key ("email") references "accounts" ("secret_id") on delete cascade on update restrict;

alter table "users" add constraint "father_fk" foreign key ("fatherId") references "users" ("id") on delete restrict on update restrict;

alter table "users" drop column "data";

alter table "accounts" add column "email" varchar(255) default 'test' not null;

alter table "accounts" add constraint "unique_c_accounts_email" unique ("email");

update "private_test_settings" set "value" = '2.0.0' where "key" = 'version';

update "private_test_settings" set "value" = '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.name":{"convex":"name","drizzle":"name","prisma":"name","mongodb":"name","sql":"name"},"users.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"users.stringColumn":{"convex":"stringColumn","drizzle":"stringColumn","prisma":"stringColumn","mongodb":"string","sql":"string"},"users.bigintColumn":{"convex":"bigintColumn","drizzle":"bigintColumn","prisma":"bigintColumn","mongodb":"bigint","sql":"bigint"},"users.integerColumn":{"convex":"integerColumn","drizzle":"integerColumn","prisma":"integerColumn","mongodb":"integer","sql":"integer"},"users.decimalColumn":{"convex":"decimalColumn","drizzle":"decimalColumn","prisma":"decimalColumn","mongodb":"decimal","sql":"decimal"},"users.boolColumn":{"convex":"boolColumn","drizzle":"boolColumn","prisma":"boolColumn","mongodb":"bool","sql":"bool"},"users.jsonColumn":{"convex":"jsonColumn","drizzle":"jsonColumn","prisma":"jsonColumn","mongodb":"json","sql":"json"},"users.binaryColumn":{"convex":"binaryColumn","drizzle":"binaryColumn","prisma":"binaryColumn","mongodb":"binary","sql":"binary"},"users.dateColumn":{"convex":"dateColumn","drizzle":"dateColumn","prisma":"dateColumn","mongodb":"date","sql":"date"},"users.timestampColumn":{"convex":"timestampColumn","drizzle":"timestampColumn","prisma":"timestampColumn","mongodb":"timestamp","sql":"timestamp"},"users.fatherId":{"convex":"fatherId","drizzle":"fatherId","prisma":"fatherId","mongodb":"fatherId","sql":"fatherId"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"},"accounts.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"}}' where "key" = 'name-variants';
/* --- */
alter table "users" drop constraint if exists "account_fk";

alter table "users" drop constraint if exists "father_fk";

alter table "users" drop constraint "unique_c_users_email";

alter table "users" alter column "image" drop default;

alter table "users" drop column "string";

alter table "users" drop column "bigint";

alter table "users" drop column "integer";

alter table "users" drop column "decimal";

alter table "users" drop column "bool";

alter table "users" drop column "json";

alter table "users" drop column "binary";

alter table "users" drop column "date";

alter table "users" drop column "timestamp";

alter table "users" drop column "fatherId";

alter table "accounts" alter column "email" drop default;

alter table "accounts" drop constraint "unique_c_accounts_email";

update "private_test_settings" set "value" = '3.0.0' where "key" = 'version';

update "private_test_settings" set "value" = '{"users":{"convex":"users","drizzle":"users","prisma":"users","mongodb":"users","sql":"users"},"users.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"id"},"users.name":{"convex":"name","drizzle":"name","prisma":"name","mongodb":"name","sql":"name"},"users.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"},"users.image":{"convex":"image","drizzle":"image","prisma":"image","mongodb":"image","sql":"image"},"accounts":{"convex":"accounts","drizzle":"accounts","prisma":"accounts","mongodb":"accounts","sql":"accounts"},"accounts.id":{"convex":"id","drizzle":"id","prisma":"id","mongodb":"_id","sql":"secret_id"},"accounts.email":{"convex":"email","drizzle":"email","prisma":"email","mongodb":"email","sql":"email"}}' where "key" = 'name-variants';