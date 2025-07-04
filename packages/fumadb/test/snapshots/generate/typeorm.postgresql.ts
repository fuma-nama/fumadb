import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from "typeorm"

@Entity("users")
export class Users {
  @PrimaryGeneratedColumn({
    length: 255
  })
  id: string;

  @Column({
    length: 255
  })
  name: string;

  @Column({
    length: 255
  })
  email: string;

  @Column({
    length: 200,
    nullable: true,
    default: "my-avatar"
  })
  image: string | null;

  @JoinColumn([{ name: "id", referencedColumnName: "id" }])
  @OneToOne(() => Accounts, v => v.user)
  account: Accounts

  @OneToMany(() => Posts, v => v.author)
  posts: Posts[]
}

@Entity("accounts")
export class Accounts {
  @PrimaryColumn({
    length: 255
  })
  id: string;

  @OneToOne(() => Users, v => v.account)
  user: Users
}

@Entity("posts")
export class Posts {
  @PrimaryGeneratedColumn({
    length: 255
  })
  id: string;

  @Column({
    length: 255,
    name: "author_id"
  })
  authorId: string;

  @Column()
  content: string;

  @JoinColumn([{ name: "authorId", referencedColumnName: "id" }])
  @ManyToOne(() => Users, v => v.posts)
  author: Users
}