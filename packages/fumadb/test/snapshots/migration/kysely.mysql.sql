create table `users` (`id` varchar(255) not null primary key, `image` varchar(200) default 'my-avatar', `data` longblob);

create table `accounts` (`secret_id` varchar(255) not null primary key);

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;
/* --- */
alter table `users` add column `name` varchar(255) not null;

alter table `users` add column `email` varchar(255) not null;

alter table `users` modify column `image` varchar(200) default 'another-avatar';

alter table `users` add constraint `account_fk` foreign key (`email`) references `accounts` (`secret_id`) on delete cascade on update restrict;

alter table `accounts` add column `email` varchar(255) not null;

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;
/* --- */
alter table `users` modify column `image` text;

alter table `users` drop constraint `account_fk`;

alter table `users` add constraint `account_fk` foreign key (`email`) references `accounts` (`secret_id`) on delete restrict on update restrict;

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;