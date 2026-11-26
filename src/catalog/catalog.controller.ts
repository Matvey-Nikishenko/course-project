import { Controller, Get, Param } from '@nestjs/common';
import { logger } from '../observability/logger';
import { CatalogService } from './catalog.service';
import type { CatalogCard } from './catalog.repo';

@Controller('catalog')
export class CatalogController {
  private readonly log = logger.child({ layer: 'catalog.controller' });

  constructor(private readonly catalog: CatalogService) {}

  @Get(':id')
  card(@Param('id') id: string): Promise<CatalogCard> {
    this.log.info({ id }, 'card');
    return this.catalog.card(id);
  }
}
