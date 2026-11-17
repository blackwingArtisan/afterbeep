import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2';
import type { SmsMessage, SmsSender } from './types';

export interface AwsSmsOptions {
  region: string;
  /** The phone number or pool ID registered in AWS End User Messaging SMS. */
  originationIdentity: string;
  configurationSetName?: string;
}

/** AWS End User Messaging SMS (the SMS and Voice v2 API). */
export class AwsSms implements SmsSender {
  readonly name = 'aws-end-user-messaging';
  private readonly client: PinpointSMSVoiceV2Client;

  constructor(private readonly options: AwsSmsOptions) {
    this.client = new PinpointSMSVoiceV2Client({ region: options.region });
  }

  async send(message: SmsMessage) {
    const result = await this.client.send(
      new SendTextMessageCommand({
        DestinationPhoneNumber: message.to,
        OriginationIdentity: this.options.originationIdentity,
        MessageBody: message.body,
        MessageType: 'TRANSACTIONAL',
        ConfigurationSetName: this.options.configurationSetName,
      }),
    );
    return { provider: this.name, providerRef: result.MessageId ?? null };
  }
}
