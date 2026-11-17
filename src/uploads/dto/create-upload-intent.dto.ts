import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateUploadIntentDto {
  @IsString()
  @MinLength(1)
  filename!: string;

  @IsString()
  @MinLength(1)
  content_type!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  size_bytes!: number;
}
