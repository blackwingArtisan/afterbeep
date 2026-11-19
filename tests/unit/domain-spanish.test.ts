import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSpanish } from '../../src/domain/spanish';
import { extractWithRules } from '../../src/domain/voicemail-rules';
import { simulatorScripts } from '../../src/server/seed';

const ctx = (callerId: string) => ({ callerId, defaultAreaCode: '614' });

describe('Spanish callers', () => {
  it('[MC 3.10] reads a Spanish emergency for the same details, in English for the owner', () => {
    const rosa = simulatorScripts.find((s) => s.id === 'spanish-heater')!;
    expect(extractWithRules(rosa.transcript, ctx(rosa.from))).toMatchObject({
      callerName: 'Rosa Delgado',
      callbackNumber: '(614) 555-0185',
      address: '1420 Juniper Street',
      job: 'Water heater: burst, flooding',
      jobCategory: 'water-heater',
      urgency: 'emergency',
      language: 'es',
    });
  });

  it('[MC 3.10] keeps accents in names and applies the same urgency rules', () => {
    const tomas = extractWithRules('Hola, soy Tomás Reyes. No hay calefacción y tenemos un bebé en la casa. 9 Ember Court.', ctx('+16145550189'));
    expect(tomas).toMatchObject({ callerName: 'Tomás Reyes', jobCategory: 'heating', urgency: 'emergency', language: 'es' });
    expect(tomas.summary).toMatch(/^Tomás Reyes at 9 Ember Court\. Heating: no heat\. Emergency, call back now\. Left the message in Spanish\.$/);

    const marisol = extractWithRules('Buenas tardes, habla Marisol Ortega. Mi secadora no calienta, no hay prisa. Vivo en 66 Orchard Lane.', ctx('+16145550187'));
    expect(marisol).toMatchObject({ callerName: 'Marisol Ortega', job: 'Dryer: not heating', urgency: 'routine', language: 'es' });
  });

  it('[MC 3.10] never flags an English voicemail as Spanish', () => {
    const { cases } = JSON.parse(readFileSync('eval/voicemails.json', 'utf8')) as { cases: Array<{ transcript: string }> };
    const english = [...cases.map((c) => c.transcript), ...simulatorScripts.filter((s) => s.id !== 'spanish-heater').map((s) => s.transcript)];
    expect(english.filter(isSpanish)).toEqual([]);
    expect(isSpanish('Hi, this is Ana at 12 Calle Real Drive, my water heater is leaking, please call me back.')).toBe(false);
    expect(extractWithRules('Hi, this is Ivy Sloane at 12 Oak Street.', ctx('+16145550101')).language).toBeUndefined();
  });
});
