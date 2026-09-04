export interface OrderItem {
  product_id: number;
  quantity: number;
  unit_price_cents: number;
}

export interface Order {
  id: number;
  items: OrderItem[];
  total_cents: number;
  status: 'new' | 'paid' | 'cancelled';
  created_at: string;
}
