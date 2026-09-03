export interface Product {
  id: number;
  title: string;
  price_cents: number;
  stock: number;
  image_url: string | null;
}
