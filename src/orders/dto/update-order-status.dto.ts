import { IsIn } from 'class-validator';

export const ORDER_STATUSES = ['new', 'paid', 'shipped', 'cancelled'] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES)
  status!: OrderStatusName;
}
