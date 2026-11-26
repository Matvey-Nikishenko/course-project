import { Injectable } from '@nestjs/common';
import { logger } from '../observability/logger';
import { CatalogCard, CatalogRepo } from './catalog.repo';

@Injectable()
export class CatalogService {
  private readonly log = logger.child({ layer: 'catalog.service' });
  private readonly repo = new CatalogRepo();

  card(id: string): Promise<CatalogCard> {
    this.log.info({ id }, 'card');
    return this.repo.load(id);
  }
}
