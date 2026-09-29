import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderItem } from './order-item';
import { User } from './user';

export type OrderStatus = 'new' | 'paid' | 'shipped' | 'cancelled';

@Entity({ name: 'orders' })
@Check(`status IN ('new', 'paid', 'shipped', 'cancelled')`)
@Check(`total >= 0`)
@Index('idx_orders_buyer_created', ['buyer', 'createdAt'])
@Index('idx_orders_pending_created', ['createdAt'], { where: "status = 'new'" })
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  // Order history outlives the account's "please delete me" — RESTRICT, not CASCADE.
  @ManyToOne(() => User, (user) => user.orders, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'buyer_id' })
  buyer!: User;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ type: 'int' })
  total!: number;

  // Regular column (not CreateDateColumn) so seed can set a frozen created_at
  // that is the order's natural key: (buyer, created_at).
  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items!: OrderItem[];
}
