// AWS Lambda (Node.js 22), triggered by S3 ObjectCreated on the Amazon Connect call-recordings prefix.
// Looks up the caller number saved by the contact flow and hands the recording to AfterBeep.
// Environment: CONNECT_INSTANCE_ID, AFTERBEEP_URL, AFTERBEEP_WEBHOOK_SECRET.
import { ConnectClient, GetContactAttributesCommand } from '@aws-sdk/client-connect';

const connect = new ConnectClient({});

export async function handler(event) {
  const results = [];
  for (const record of event.Records ?? []) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    // Recordings are stored as .../CallRecordings/YYYY/MM/DD/<contactId>_<timestamp>.wav
    const contactId = key.split('/').pop()?.split('_')[0];
    if (!contactId) continue;

    const { Attributes = {} } = await connect.send(
      new GetContactAttributesCommand({ InstanceId: process.env.CONNECT_INSTANCE_ID, InitialContactId: contactId }),
    );
    const callerNumber = Attributes.afterbeepCaller;
    if (!callerNumber) continue;

    const res = await fetch(`${process.env.AFTERBEEP_URL}/api/hooks/connect-voicemail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AFTERBEEP_WEBHOOK_SECRET}` },
      body: JSON.stringify({ contactId, callerNumber, recordingUri: `s3://${bucket}/${key}` }),
    });
    if (!res.ok) throw new Error(`AfterBeep webhook returned ${res.status}: ${await res.text()}`);
    results.push(await res.json());
  }
  return results;
}
