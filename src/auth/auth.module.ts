import { Module } from '@nestjs/common';
import { RolesGuard } from '../roles/roles.guard';
import { TypeormModule } from '../typeorm/typeorm.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [TypeormModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
