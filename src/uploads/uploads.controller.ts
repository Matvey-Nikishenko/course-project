import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessClaims } from '../auth/tokens';
import { CommitUploadDto } from './dto/commit-upload.dto';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('intent')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  intent(
    @CurrentUser() user: AccessClaims,
    @Body() dto: CreateUploadIntentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.uploads.intent(user, dto, idempotencyKey);
  }

  @Post('resume')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  resume(@CurrentUser() user: AccessClaims, @Body() dto: CommitUploadDto) {
    return this.uploads.resume(user, dto.id);
  }

  @Post('commit')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  commit(@CurrentUser() user: AccessClaims, @Body() dto: CommitUploadDto) {
    return this.uploads.commit(user, dto.id);
  }
}
