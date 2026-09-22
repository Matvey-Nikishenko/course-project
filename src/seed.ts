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
      user = await userRepo.save(userRepo.create(row));
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

  const productList = [...productsByName.values()];
  const buyers = BUYERS.map((row) => usersByEmail.get(row.email)!);

  const seededOrders = await orderRepo
    .createQueryBuilder('o')
    .innerJoin('o.buyer', 'b')
    .where('b.email IN (:...emails)', { emails: BUYERS.map((b) => b.email) })
    .getCount();
  if (seededOrders >= 10) {
    const [users, products, orders, items] = await Promise.all([
      userRepo.count(),
      productRepo.count(),
      orderRepo.count(),
      ds.getRepository(OrderItem).count(),
    ]);
    console.log(`seed already applied  users=${users} products=${products} orders=${orders} order_items=${items}`);
    await ds.destroy();
    return;
  }

  for (let i = 0; i < 10; i++) {
    const a = productList[i % productList.length];
    const b = productList[(i + 2) % productList.length];
    const itemA = new OrderItem();
    itemA.product = a;
    itemA.quantity = (i % 3) + 1;
    itemA.unitPrice = a.price;
    const itemB = new OrderItem();
    itemB.product = b;
    itemB.quantity = 1;
    itemB.unitPrice = b.price;

    const order = new Order();
    order.buyer = buyers[i % buyers.length];
    order.status = i % 5 === 0 ? 'new' : 'paid';
    order.total = itemA.quantity * itemA.unitPrice + itemB.quantity * itemB.unitPrice;
    order.items = [itemA, itemB];
    await orderRepo.save(order);
  }

  const [users, products, orders, items] = await Promise.all([
    userRepo.count(),
    productRepo.count(),
    orderRepo.count(),
    ds.getRepository(OrderItem).count(),
  ]);
  console.log(`seed ok  users=${users} products=${products} orders=${orders} order_items=${items}`);

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
