import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Order } from './order';
import { Product } from './product';

// M:N with data on the link (quantity, unit price at checkout) — join entity, not @ManyToMany.
@Entity({ name: 'order_items' })
@Unique('order_items_order_id_product_id_key', ['order', 'product'])
@Check(`quantity > 0`)
@Check(`unit_price >= 0`)
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  // Lines have no meaning without the order — they go with it.
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  // Deleting a product that has been sold would rewrite history — forbidden.
  @ManyToOne(() => Product, (product) => product.items, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'product_id' })
  @Index('idx_order_items_product_id')
  product!: Product;

  @Column({ type: 'int' })
  quantity!: number;

  // Snapshot at checkout, not a live pointer at products.price.
  @Column({ type: 'int', name: 'unit_price' })
  unitPrice!: number;
}
