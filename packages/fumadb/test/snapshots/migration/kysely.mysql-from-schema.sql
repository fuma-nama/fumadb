create table `users` (`id` varchar(255) not null primary key, `image` varchar(200) default 'my-avatar', `data` longblob);

create table `accounts` (`secret_id` varchar(255) not null primary key);

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;
/* --- */
alter table `users` add column `name` varchar(255) not null;

alter table `users` add column `email` varchar(255) not null;

alter table `users` modify column `image` text;

alter table `users` add column `string` text;

alter table `users` add column `bigint` bigint;

alter table `users` add column `integer` integer;

alter table `users` add column `decimal` decimal;

alter table `users` add column `bool` boolean;

alter table `users` add column `json` json;

alter table `users` add column `binary` longblob;

alter table `users` add column `date` date;

alter table `users` add column `timestamp` timestamp;

alter table `users` add column `fatherId` varchar(255);

alter table `users` add constraint `unique_c_users_fatherId` unique (`fatherId`);

alter table `users` add constraint `account_fk` foreign key (`email`) references `accounts` (`secret_id`) on delete cascade on update restrict;

alter table `users` add constraint `father_fk` foreign key (`fatherId`) references `users` (`id`) on delete restrict on update restrict;

alter table `users` drop column `data`;

alter table `accounts` add column `email` varchar(255) not null;

alter table `accounts` add constraint `unique_c_accounts_email` unique (`email`);

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;
/* --- */
alter table `users` modify column `email` varchar(255) not null;

alter table `users` add constraint `unique_c_users_email` unique (`email`);

alter table `users` drop constraint `account_fk`;

alter table `users` add constraint `account_fk` foreign key (`email`) references `accounts` (`secret_id`) on delete restrict on update restrict;

alter table `users` drop constraint `father_fk`;

alter table `users` drop column `string`;

alter table `users` drop column `bigint`;

alter table `users` drop column `integer`;

alter table `users` drop column `decimal`;

alter table `users` drop column `bool`;

alter table `users` drop column `json`;

alter table `users` drop column `binary`;

alter table `users` drop column `date`;

alter table `users` drop column `timestamp`;

alter table `users` drop column `fatherId`;

alter table `accounts` modify column `email` varchar(255) not null;

alter table `accounts` drop constraint `unique_c_accounts_email`;

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;