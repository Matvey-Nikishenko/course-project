import dataSource from './data-source';
import { Product } from './entities/product';

interface RevenueRow {
  name: string;
  units: string;
  revenue_cents: string;
}

async function main(): Promise<void> {
  await dataSource.initialize();

  const rows = await dataSource
    .getRepository(Product)
    .createQueryBuilder('p')
    .innerJoin('p.items', 'oi')
    .select('p.name', 'name')
    .addSelect('SUM(oi.quantity)', 'units')
    .addSelect('SUM(oi.quantity * oi.unit_price)', 'revenue_cents')
    .groupBy('p.id')
    .addGroupBy('p.name')
    .orderBy('revenue_cents', 'DESC')
    .getRawMany<RevenueRow>();

  console.log('Revenue by product (price at purchase time):');
  console.table(
    rows.map((row) => ({
      name: row.name,
      units: Number(row.units),
      revenue_uah: Number(row.revenue_cents) / 100,
    })),
  );

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
