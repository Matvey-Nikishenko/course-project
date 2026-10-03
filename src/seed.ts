import dataSource from './data-source';
import { Order } from './entities/order';
import { OrderItem } from './entities/order-item';
import { Product } from './entities/product';
import { User } from './entities/user';

const SELLERS = [
  { email: 'seller-anna@example.com', role: 'seller' as const },
  { email: 'seller-bohdan@example.com', role: 'seller' as const },
];

const BUYERS = [
  { email: 'buyer-kateryna@example.com', role: 'buyer' as const },
  { email: 'buyer-dmytro@example.com', role: 'buyer' as const },
  { email: 'buyer-olena@example.com', role: 'buyer' as const },
];

const CATALOG: { name: string; description: string; price: number; stock: number; sellerEmail: string }[] = [
  {
    name: 'Клавіатура механічна',
    description: 'Клавіатура з українською розкладкою.',
    price: 260000,
    stock: 20,
    sellerEmail: 'seller-anna@example.com',
  },
  {
    name: 'Мишка бездротова',
    description: 'Тиха мишка для офісу.',
    price: 125000,
    stock: 40,
    sellerEmail: 'seller-anna@example.com',
  },
  {
    name: 'Монітор 27 дюймів',
    description: 'IPS-панель для роботи з кольором.',
    price: 890000,
    stock: 8,
    sellerEmail: 'seller-bohdan@example.com',
  },
  {
    name: 'Ноутбук офісний',
    description: 'Легкий ноутбук для щоденної роботи.',
    price: 3200000,
    stock: 5,
    sellerEmail: 'seller-bohdan@example.com',
  },
  {
    name: 'Шкіряні кросівки',
    description: 'Кросівки зі шкіри, модель для міста.',
    price: 450000,
    stock: 15,
    sellerEmail: 'seller-anna@example.com',
  },
  {
    name: 'Сумка текстильна',
    description: 'Легка сумка на щодень.',
    price: 99000,
    stock: 30,
    sellerEmail: 'seller-bohdan@example.com',
  },
];

// Natural key of a seed order: (buyer email, created_at). Frozen timestamps so
// a second run finds the row instead of counting ">= 10" and inserting again
// after someone deletes a single order.
const SEED_ORDERS = Array.from({ length: 10 }, (_, i) => ({
  buyerEmail: BUYERS[i % BUYERS.length].email,
  status: i % 5 === 0 ? ('new' as const) : ('paid' as const),
  createdAt: new Date(Date.UTC(2026, 0, 15, 12, 0, i)),
  lines: [
    { productName: CATALOG[i % CATALOG.length].name, quantity: (i % 3) + 1 },
    { productName: CATALOG[(i + 2) % CATALOG.length].name, quantity: 1 },
  ],
}));

async function counts(ds: typeof dataSource): Promise<string> {
  const [users, products, orders, items] = await Promise.all([
    ds.getRepository(User).count(),
    ds.getRepository(Product).count(),
    ds.getRepository(Order).count(),
    ds.getRepository(OrderItem).count(),
  ]);
  return `users=${users} products=${products} orders=${orders} order_items=${items}`;
}

async function main(): Promise<void> {
  const ds = dataSource;
  await ds.initialize();

  const userRepo = ds.getRepository(User);
  const productRepo = ds.getRepository(Product);
  const orderRepo = ds.getRepository(Order);

  const usersByEmail = new Map<string, User>();
  for (const row of [...SELLERS, ...BUYERS]) {
    let user = await userRepo.findOne({ where: { email: row.email } });
    if (!user) {
      user = await userRepo.save(userRepo.create({ ...row, balanceCents: 100_000_000 }));
    } else if (user.balanceCents < 100_000_000) {
      user.balanceCents = 100_000_000;
      await userRepo.save(user);
    }
    usersByEmail.set(row.email, user);
  }

  const productsByName = new Map<string, Product>();
  for (const row of CATALOG) {
    const seller = usersByEmail.get(row.sellerEmail)!;
    let product = await productRepo.findOne({
      where: { name: row.name, seller: { id: seller.id } },
    });
    if (!product) {
      product = await productRepo.save(
        productRepo.create({
          name: row.name,
          description: row.description,
          price: row.price,
          stock: row.stock,
          seller,
        }),
      );
    }
    productsByName.set(row.name, product);
  }

  for (const spec of SEED_ORDERS) {
    const buyer = usersByEmail.get(spec.buyerEmail)!;
    const existing = await orderRepo
      .createQueryBuilder('o')
      .innerJoin('o.buyer', 'b')
      .where('b.email = :email', { email: spec.buyerEmail })
      .andWhere('o.created_at = :createdAt', { createdAt: spec.createdAt })
      .getOne();
    if (existing) {
      continue;
    }

    const items = spec.lines.map((line) => {
      const product = productsByName.get(line.productName)!;
      const item = new OrderItem();
      item.product = product;
      item.quantity = line.quantity;
      item.unitPrice = product.price;
      return item;
    });

    const order = new Order();
    order.buyer = buyer;
    order.status = spec.status;
    order.createdAt = spec.createdAt;
    order.items = items;
    order.total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    await orderRepo.save(order);
  }

  console.log(`seed ok  ${await counts(ds)}`);
  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
