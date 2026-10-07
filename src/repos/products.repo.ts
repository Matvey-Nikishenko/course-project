import { Queryable } from './queryable';

export type ProductRow = {
  id: string;
  name: string;
  price: number;
  stock: number;
  seller_id: string;
};

export type SellerCatalogRow = {
  product_id: string;
  name: string;
  seller_email: string;
  revenue_cents: number;
};

export class ProductsRepo {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    sellerId: string;
    name: string;
    price: number;
    stock: number;
    description?: string;
  }): Promise<ProductRow> {
    const { rows } = await this.db.query<ProductRow>(
      `INSERT INTO products (seller_id, name, description, price, stock)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, price, stock, seller_id`,
      [input.sellerId, input.name, input.description ?? '', input.price, input.stock],
    );
    return rows[0];
  }

  async findById(id: string): Promise<ProductRow | null> {
    const { rows } = await this.db.query<ProductRow>(
      `SELECT id, name, price, stock, seller_id FROM products WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * JOIN users + LEFT JOIN order_items, GROUP BY seller.
   * This is the SQL a mock repository does not execute.
   */
  async catalogWithRevenue(): Promise<SellerCatalogRow[]> {
    const { rows } = await this.db.query<SellerCatalogRow>(
      `SELECT p.id AS product_id,
              p.name,
              u.email AS seller_email,
              coalesce(sum(oi.quantity * oi.unit_price), 0)::int AS revenue_cents
       FROM products p
       JOIN users u ON u.id = p.seller_id
       LEFT JOIN order_items oi ON oi.product_id = p.id
       GROUP BY p.id, p.name, u.email
       ORDER BY p.id`,
    );
    return rows;
  }
}
