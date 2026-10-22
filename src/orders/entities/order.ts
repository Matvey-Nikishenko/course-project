export interface OrderItem {
  product_id: number;
  quantity: number;
  unit_price_cents: number;
}

export interface Order {
  id: number;
  buyer_id: number;
  items: OrderItem[];
  total_cents: number;
  status: 'new' | 'paid' | 'shipped' | 'cancelled';
  created_at: string;
}
