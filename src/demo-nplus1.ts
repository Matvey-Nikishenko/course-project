import { DataSource } from 'typeorm';
import dataSource from './data-source';
import { Order } from './entities/order';
import { OrderItem } from './entities/order-item';
import { QueryCountLogger } from './query-count.logger';

async function main(): Promise<void> {
  const logger = new QueryCountLogger(['query']);
  const ds = new DataSource({ ...dataSource.options, logger });
  await ds.initialize();

  const orderRepo = ds.getRepository(Order);
  const itemRepo = ds.getRepository(OrderItem);

  console.log('── Naive: find() + a query per order and per product ──');
  logger.echo = true;
  logger.reset();
  const orders = await orderRepo.find();
  for (const order of orders) {
    const items = await itemRepo.find({ where: { order: { id: order.id } } });
    for (const item of items) {
      await ds.createQueryBuilder().relation(OrderItem, 'product').of(item).loadOne();
    }
  }
  const naiveCount = logger.count;
  console.log(`Total queries: ${naiveCount} (orders collection = ${orders.length})\n`);

  console.log('── Fix: relations (order → items → product), one JOIN ──');
  logger.reset();
  const joined = await orderRepo.find({
    relations: { items: { product: true } },
  });
  const joinCount = logger.count;
  console.log(`Total queries: ${joinCount}, orders: ${joined.length}\n`);

  console.log('── Fix: leftJoinAndSelect, the same JOIN spelled out ──');
  logger.reset();
  const qb = await orderRepo
    .createQueryBuilder('o')
    .leftJoinAndSelect('o.items', 'item')
    .leftJoinAndSelect('item.product', 'product')
    .getMany();
  const qbCount = logger.count;
  console.log(`Total queries: ${qbCount}, orders: ${qb.length}\n`);

  console.log('── Fix: relationLoadStrategy: "query" (two relation levels) ──');
  logger.reset();
  const batched = await orderRepo.find({
    relations: { items: { product: true } },
    relationLoadStrategy: 'query',
  });
  const queryStrategyCount = logger.count;
  console.log(`Total queries: ${queryStrategyCount}, orders: ${batched.length}\n`);

  logger.echo = false;
  console.log(`N+1: naive=${naiveCount}  join=${joinCount}  queryStrategy=${queryStrategyCount}`);
  console.log(`Naive path grows with N (${orders.length} orders); JOIN and query strategy are constants.`);

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
