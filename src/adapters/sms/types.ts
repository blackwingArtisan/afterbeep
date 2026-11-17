export interface SmsMessage {
  /** E.164, e.g. +16145550134. */
  to: string;
  body: string;
  linkPath: string | null;
}

export interface SmsReceipt {
  provider: string;
  providerRef: string | null;
}

export interface SmsSender {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsReceipt>;
}
