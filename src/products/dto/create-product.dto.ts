import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  price_cents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;
}
