import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderItem } from './order-item';
import { User } from './user';

@Entity({ name: 'products' })
@Check(`length(name) > 0`)
@Check(`price >= 0`)
@Check(`stock >= 0`)
@Index('idx_products_search_vector', { synchronize: false })
export class Product {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  // Deleting a seller who still has a catalog would orphan listings.
  @ManyToOne(() => User, (user) => user.products, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'seller_id' })
  @Index('idx_products_seller_id')
  seller!: User;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  // Integer cents — never float, never numeric-as-money. Same unit as the HTTP contract.
  @Column({ type: 'int' })
  price!: number;

  @Column({ type: 'int' })
  stock!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({
    type: 'tsvector',
    name: 'search_vector',
    generatedType: 'STORED',
    asExpression: "to_tsvector('simple', name || ' ' || description)",
    insert: false,
    update: false,
    select: false,
  })
  searchVector!: string;

  @OneToMany(() => OrderItem, (item) => item.product)
  items!: OrderItem[];
}
