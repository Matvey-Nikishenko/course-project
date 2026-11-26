import { AsyncLocalStorage } from 'node:async_hooks';

/** Request fields that logs read from here. Handlers never take req in order to log them. */
export type RequestStore = {
  userId?: string;
  tenant?: string;
  idempotencyKey?: string;
};

export const requestContext = new AsyncLocalStorage<RequestStore>();
