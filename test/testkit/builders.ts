import { ProductsRepo } from '../../src/repos/products.repo';
import { UsersRepo, UserRow } from '../../src/repos/users.repo';

let seq = 0;

export class UserBuilder {
  private email = `user-${++seq}@example.com`;
  private role: 'buyer' | 'seller' = 'buyer';
  private balanceCents = 0;

  withEmail(email: string): this {
    this.email = email;
    return this;
  }

  withRole(role: 'buyer' | 'seller'): this {
    this.role = role;
    return this;
  }

  withBalance(cents: number): this {
    this.balanceCents = cents;
    return this;
  }

  build() {
    return { email: this.email, role: this.role, balanceCents: this.balanceCents };
  }

  insertVia(repo: UsersRepo): Promise<UserRow> {
    return repo.create(this.build());
  }
}

export class ProductBuilder {
  private name = `product-${++seq}`;
  private price = 260000;
  private stock = 10;
  private sellerId = '';

  withName(name: string): this {
    this.name = name;
    return this;
  }

  withPrice(cents: number): this {
    this.price = cents;
    return this;
  }

  withStock(stock: number): this {
    this.stock = stock;
    return this;
  }

  forSeller(sellerId: string): this {
    this.sellerId = sellerId;
    return this;
  }

  insertVia(repo: ProductsRepo) {
    if (!this.sellerId) {
      throw new Error('aProduct() needs forSeller(id)');
    }
    return repo.create({
      sellerId: this.sellerId,
      name: this.name,
      price: this.price,
      stock: this.stock,
    });
  }
}

export const aUser = () => new UserBuilder();
export const aProduct = () => new ProductBuilder();

/** HTTP checkout still uses this seed email (OrdersService). */
export const HTTP_BUYER_EMAIL = 'buyer-kateryna@example.com';
