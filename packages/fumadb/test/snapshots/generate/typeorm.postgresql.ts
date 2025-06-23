import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from "typeorm"

@Entity("users")
export class Users {
  @PrimaryGeneratedColumn()
  id: number;

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
}

@Entity("accounts")
export class Accounts {
  @PrimaryColumn({
    length: 255
  })
  id: string;
}