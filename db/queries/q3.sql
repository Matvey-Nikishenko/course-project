SELECT id, email, role, created_at
FROM users
WHERE lower(email) = lower('Buyer41999@Example.com')
