/** Example file uses this placeholder so a copied .env does not dial a fake user. */
const PLACEHOLDER_USER = 'USER';
const PLACEHOLDER_PASSWORD = 'PASSWORD';

export function configuredBrokerUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.username === PLACEHOLDER_USER && url.password === PLACEHOLDER_PASSWORD) return undefined;
    if (url.protocol !== 'amqp:') return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function requiredBrokerUrl(): string {
  const url = process.env.BROKER_URL;
  if (!url) throw new Error('BROKER_URL is not set');
  return url;
}
