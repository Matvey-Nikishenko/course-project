import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, Min, ValidateNested } from 'class-validator';
import { CreateOrderItemDto } from './create-order-item.dto';

export class CreateOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  buyer_id!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
