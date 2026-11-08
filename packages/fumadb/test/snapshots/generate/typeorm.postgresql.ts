import { Entity, PrimaryGeneratedColumn, Column, JoinColumn, OneToOne, OneToMany, PrimaryColumn, ManyToOne } from "typeorm"

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
  @OneToOne(() => Accounts, v => v.user, { onUpdate: "RESTRICT", onDelete: "RESTRICT" })
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

  @Column({
    type: "bytea",
    nullable: true
  })
  image: Uint8Array | null;

  @JoinColumn([{ name: "authorId", referencedColumnName: "id" }])
  @ManyToOne(() => Users, v => v.posts, { onUpdate: "RESTRICT", onDelete: "RESTRICT" })
  author: Users
}

@Entity("files")
export class Files {
  @PrimaryGeneratedColumn({
    length: 255
  })
  id: string;

  @Column({
    length: 255
  })
  bucket: string;

  @Column({
    length: 1024
  })
  key: string;

  @Column()
  name: string;

  @Column()
  size: bigint;

  @Column({
    nullable: true
  })
  metadata: object | null;

  @Column({
    length: 255,
    unique: true
  })
  checksum: string;

  @Column({
    name: "created_at",
    default: () => 'CURRENT_TIMESTAMP'
  })
  createdAt: Date;
}