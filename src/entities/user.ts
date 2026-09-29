import { Check, Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order';
import { Product } from './product';

export type UserRole = 'buyer' | 'seller';

@Entity({ name: 'users' })
@Check(`role IN ('buyer', 'seller')`)
@Index('idx_users_email_lower', { synchronize: false })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text' })
  role!: UserRole;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => Product, (product) => product.seller)
  products!: Product[];

  @OneToMany(() => Order, (order) => order.buyer)
  orders!: Order[];
}
