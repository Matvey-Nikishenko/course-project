SELECT id, status, total, created_at
FROM orders
WHERE buyer_id = 5500
  AND created_at >= '2025-06-01'::timestamptz
  AND created_at < '2026-06-01'::timestamptz
ORDER BY created_at DESC
LIMIT 20
