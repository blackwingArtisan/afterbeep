import type { Adapters } from '../../adapters';
import type { Store } from '../../adapters/store/types';

export interface Deps {
  store: Store;
  adapters: Adapters;
  clock: () => Date;
  newId: () => string;
  /** Absolute origin used in links that leave the app (texts, invoices), e.g. https://afterbeep.example.com. */
  publicBaseUrl: string;
}

export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
