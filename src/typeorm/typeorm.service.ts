import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import dataSource from '../data-source';

@Injectable()
export class TypeormService implements OnModuleInit, OnModuleDestroy {
  get ds(): DataSource {
    return dataSource;
  }

  async onModuleInit(): Promise<void> {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}
