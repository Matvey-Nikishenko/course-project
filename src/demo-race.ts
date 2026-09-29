import { CheckoutRejected, checkout } from './checkout';
import dataSource from './data-source';
import { Product } from './entities/product';
import { User } from './entities/user';

const ATTEMPTS = 50;
const STOCK = 10;
const QTY = 1;
const RACE_EMAIL = 'buyer-kateryna@example.com';
const RACE_PRODUCT = 'Race widget';

async function main(): Promise<void> {
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const productRepo = dataSource.getRepository(Product);

  const buyer = await userRepo.findOneByOrFail({ email: RACE_EMAIL });
  buyer.balanceCents = 100_000_000;
  await userRepo.save(buyer);

  let product = await productRepo.findOne({ where: { name: RACE_PRODUCT } });
  if (!product) {
    const seller = await userRepo.findOneByOrFail({ email: 'seller-anna@example.com' });
    product = await productRepo.save(
      productRepo.create({
        name: RACE_PRODUCT,
        description: 'Fixture for the 50-way checkout race.',
        price: 100,
        stock: STOCK,
        seller,
      }),
    );
  } else {
    await dataSource.query(`UPDATE products SET stock = $1 WHERE id = $2`, [STOCK, product.id]);
  }

  const results = await Promise.all(
    Array.from({ length: ATTEMPTS }, () =>
      checkout(dataSource, { buyerId: buyer.id, productId: product!.id, quantity: QTY })
        .then(() => 'ok' as const)
        .catch((err: unknown) => {
          if (err instanceof CheckoutRejected) return err.code;
          throw err;
        }),
    ),
  );

  const succeeded = results.filter((r) => r === 'ok').length;
  const [{ stock: finalStock }] = await dataSource.query<{ stock: number }[]>(
    `SELECT stock FROM products WHERE id = $1`,
    [product.id],
  );
  const [{ negatives }] = await dataSource.query<{ negatives: string }[]>(
    `SELECT count(*)::int AS negatives FROM products WHERE stock < 0`,
  );

  console.log(`attempts: ${ATTEMPTS}`);
  console.log(`succeeded: ${succeeded}`);
  console.log(`final stock: ${finalStock}`);
  console.log(`negative stock rows: ${negatives}`);

  const ok = succeeded === STOCK && Number(finalStock) === 0 && Number(negatives) === 0;
  await dataSource.destroy();
  if (!ok) {
    console.error('invariant failed: oversell or wrong success count');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
