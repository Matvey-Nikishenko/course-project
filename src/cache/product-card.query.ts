import { DataSource } from 'typeorm';

export type ProductCard = {
  id: number;
  title: string;
  priceCents: number;
  stock: number;
  sellerEmail: string;
  sold: number;
  rating: number;
};

export type QueryMeter = { queries: number };

function rowsOf(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as Record<string, unknown>[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as Record<string, unknown>[];
  return [];
}

/**
 * The product card: listing, seller, stock, units sold, and a rating derived
 * from those sales. `meter` increments here, next to the SQL, so a stampede
 * is counted by queries that ran and not by callers of the cache.
 */
export async function queryProductCard(
  ds: DataSource,
  id: string,
  meter: QueryMeter,
): Promise<ProductCard | null> {
  meter.queries += 1;
  const rows = rowsOf(
    await ds.query(
      `SELECT
         p.id,
         p.name,
         p.price,
         p.stock,
         u.email AS seller_email,
         COALESCE(SUM(oi.quantity), 0) AS sold,
         CASE
           WHEN COUNT(oi.id) = 0 THEN 0
           ELSE LEAST(5, (1 + SUM(oi.quantity) / COUNT(oi.id))::int)
         END AS rating
       FROM products p
       JOIN users u ON u.id = p.seller_id
       LEFT JOIN order_items oi ON oi.product_id = p.id
       WHERE p.id = $1
       GROUP BY p.id, u.email`,
      [id],
    ),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    title: String(row.name),
    priceCents: Number(row.price),
    stock: Number(row.stock),
    sellerEmail: String(row.seller_email),
    sold: Number(row.sold),
    rating: Number(row.rating),
  };
}
