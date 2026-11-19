// AWS Lambda (Node.js 22), subscribed to the SNS topic that AWS End User Messaging SMS publishes
// two-way replies to. Hands each reply to AfterBeep, which handles STOP, HELP and START.
// Environment: AFTERBEEP_URL, AFTERBEEP_WEBHOOK_SECRET.
export async function handler(event) {
  const results = [];
  for (const record of event.Records ?? []) {
    // The SNS message is the inbound text as JSON: originationNumber is the caller, messageBody the reply.
    const inbound = JSON.parse(record.Sns.Message);
    const res = await fetch(`${process.env.AFTERBEEP_URL}/api/hooks/inbound-text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AFTERBEEP_WEBHOOK_SECRET}` },
      body: JSON.stringify({ from: inbound.originationNumber, body: inbound.messageBody ?? '' }),
    });
    if (!res.ok) throw new Error(`AfterBeep webhook returned ${res.status}: ${await res.text()}`);
    results.push(await res.json());
  }
  return results;
}
