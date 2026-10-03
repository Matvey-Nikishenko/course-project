export function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.driverError?.code ?? e.code;
}

function isRetryable(err: unknown): boolean {
  const code = pgErrorCode(err);
  return code === '40001' || code === '40P01';
}

export async function withSerializationRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; label?: string } = {},
): Promise<{ result: T; retries: number }> {
  const maxAttempts = options.maxAttempts ?? 8;
  const label = options.label ?? 'tx';
  let last: unknown;
  let retries = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, retries };
    } catch (err) {
      last = err;
      if (!isRetryable(err) || attempt === maxAttempts) {
        throw err;
      }
      retries += 1;
      const backoffMs = 10 * 2 ** (attempt - 1);
      console.log(
        `retry ${label}: caught ${pgErrorCode(err)} attempt ${attempt}/${maxAttempts}, backoff ${backoffMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw last;
}
