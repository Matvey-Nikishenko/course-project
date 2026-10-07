import { ProductsRepo } from '../../src/repos/products.repo';
import { UsersRepo } from '../../src/repos/users.repo';
import { aProduct, aUser } from '../testkit/builders';
import { PgHandle, startPg, truncateAll } from '../testkit/pg-container';

describe('ProductsRepo', () => {
  let pg: PgHandle;
  let users: UsersRepo;
  let products: ProductsRepo;

  beforeAll(async () => {
    pg = await startPg('(products.repo)');
    users = new UsersRepo(pg.pool);
    products = new ProductsRepo(pg.pool);
  });

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await truncateAll(pg.pool);
  });

  test('create then findById', async () => {
    const seller = await aUser().withRole('seller').insertVia(users);
    const created = await aProduct()
      .forSeller(seller.id)
      .withName('Keyboard')
      .withPrice(260000)
      .withStock(8)
      .insertVia(products);
    const found = await products.findById(created.id);
    expect(found).toMatchObject({
      id: created.id,
      name: 'Keyboard',
      price: 260000,
      stock: 8,
      seller_id: seller.id,
    });
  });

  test('insert with unknown seller_id hits foreign key 23503', async () => {
    await expect(aProduct().forSeller('999999').insertVia(products)).rejects.toMatchObject({
      code: '23503',
    });
  });

  test('catalogWithRevenue JOINs seller and aggregates order_items', async () => {
    const seller = await aUser().withRole('seller').insertVia(users);
    const buyer = await aUser().withRole('buyer').insertVia(users);
    const product = await aProduct()
      .forSeller(seller.id)
      .withName('Mouse')
      .withPrice(125000)
      .insertVia(products);

    await pg.pool.query(
      `INSERT INTO orders (buyer_id, status, total) VALUES ($1, 'paid', 250000) RETURNING id`,
      [buyer.id],
    );
    const { rows } = await pg.pool.query<{ id: string }>(
      `SELECT id FROM orders ORDER BY id DESC LIMIT 1`,
    );
    await pg.pool.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
       VALUES ($1, $2, 2, 125000)`,
      [rows[0].id, product.id],
    );

    const catalog = await products.catalogWithRevenue();
    expect(catalog).toEqual([
      {
        product_id: product.id,
        name: 'Mouse',
        seller_email: seller.email,
        revenue_cents: 250000,
      },
    ]);
  });
});
