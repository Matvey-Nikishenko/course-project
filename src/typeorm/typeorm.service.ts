import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataSource } from '../data-source';

@Injectable()
export class TypeormService implements OnModuleInit, OnModuleDestroy {
  private source!: DataSource;

  get ds(): DataSource {
    return this.source;
  }

  async onModuleInit(): Promise<void> {
    this.source = buildDataSource();
    if (!this.source.isInitialized) {
      await this.source.initialize();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.source?.isInitialized) {
      await this.source.destroy();
    }
  }
}
