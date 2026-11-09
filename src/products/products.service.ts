import { Injectable, NotFoundException } from '@nestjs/common';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { paginate } from '../common/pagination/pagination';
import { CacheService } from '../cache/cache.service';
import { Product as ProductRow } from '../entities/product';
import { TypeormService } from '../typeorm/typeorm.service';
import { CreateProductDto } from './dto/create-product.dto';
import type { Product } from './entities/product';

@Injectable()
export class ProductsService {
  constructor(
    private readonly typeorm: TypeormService,
    private readonly cache: CacheService,
  ) {}

  async list(query: CursorPageQueryDto) {
    const rows = await this.typeorm.ds.getRepository(ProductRow).find({
      order: { id: 'ASC' },
    });
    return paginate(
      rows.map((row) => this.toHttp(row)),
      query.limit ?? 10,
      query.cursor,
    );
  }

  async findOne(id: number) {
    const card = await this.cache.read(id);
    if (!card) {
      throw new NotFoundException({
        code: 'not-found',
        detail: `product ${id} not found`,
      });
    }
    return {
      id: card.id,
      title: card.title,
      price_cents: card.priceCents,
      stock: card.stock,
      image_url: null,
    };
  }

  async createForSeller(sellerId: string, dto: CreateProductDto): Promise<Product> {
    const raw: unknown = await this.typeorm.ds.query(
      `INSERT INTO products (seller_id, name, description, price, stock)
       VALUES ($1, $2, '', $3, $4)
       RETURNING id, name, price, stock`,
      [sellerId, dto.title, dto.price_cents, dto.stock],
    );
    const list = (Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw) as {
      id: string;
      name: string;
      price: number;
      stock: number;
    }[];
    const row = list[0];
    return {
      id: Number(row.id),
      title: row.name,
      price_cents: Number(row.price),
      stock: Number(row.stock),
      image_url: null,
    };
  }

  private toHttp(row: ProductRow): Product {
    return {
      id: Number(row.id),
      title: row.name,
      price_cents: row.price,
      stock: row.stock,
      image_url: null,
    };
  }
}
