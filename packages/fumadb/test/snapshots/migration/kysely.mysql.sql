create table `users` (`id` integer primary key auto_increment, `name` varchar(255), `email` varchar(255), `image` varchar(200) default 'my-avatar');

create table `accounts` (`secret_id` varchar(255));