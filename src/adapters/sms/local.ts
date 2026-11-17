import type { Store } from '../store/types';
import type { SmsMessage, SmsSender } from './types';

/** Writes texts to the outbox instead of a carrier. The outbox page shows exactly what would be sent. */
export class OutboxSms implements SmsSender {
  readonly name = 'outbox';
  constructor(
    private readonly store: Store,
    private readonly clock: () => Date,
    private readonly newId: () => string,
  ) {}

  async send(message: SmsMessage) {
    const id = this.newId();
    this.store.update((db) => {
      db.outbox.push({
        id,
        kind: 'sms',
        to: message.to,
        body: message.body,
        linkPath: message.linkPath,
        createdAt: this.clock().toISOString(),
        provider: this.name,
      });
    });
    return { provider: this.name, providerRef: id };
  }
}
