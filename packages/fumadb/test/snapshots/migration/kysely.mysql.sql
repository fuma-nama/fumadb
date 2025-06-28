create table `users` (`id` varchar(255) not null primary key, `image` varchar(200) default 'my-avatar');

create table `accounts` (`secret_id` varchar(255) not null);

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;
/* --- */
alter table `users` add column `name` varchar(255) not null, add column `email` varchar(255) not null;

alter table `accounts` add column `email` varchar(255) not null;

update `private_test_version` set `id` = ?, `version` = ? where `id` = ?;