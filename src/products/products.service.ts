import { Injectable, NotFoundException } from '@nestjs/common';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { paginate } from '../common/pagination/pagination';
import { Product as ProductRow } from '../entities/product';
import { TypeormService } from '../typeorm/typeorm.service';
import type { Product } from './entities/product';

@Injectable()
export class ProductsService {
  constructor(private readonly typeorm: TypeormService) {}

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
    const row = await this.typeorm.ds.getRepository(ProductRow).findOne({
      where: { id: String(id) },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'not-found',
        detail: `product ${id} not found`,
      });
    }
    return this.toHttp(row);
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
