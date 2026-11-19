/**
 * Spanish-speaking callers. About 13% of people in the US speak Spanish at home, and a caller who
 * leaves a message in Spanish should get a text they can read. The rules detect Spanish, translate
 * the handful of trade phrases the extractor needs into English, and leave everything else alone:
 * names, numbers and street addresses read the same in both languages.
 */

/** Words that are common in Spanish speech and rare in English voicemails. */
const SPANISH_MARKERS = new Set([
  'hola', 'buenas', 'buenos', 'soy', 'llamo', 'habla', 'mi', 'tengo', 'tenemos', 'estoy', 'está', 'esta', 'hay', 'por',
  'favor', 'gracias', 'llámeme', 'llameme', 'llámame', 'llamame', 'agua', 'calentador', 'secadora', 'lavadora', 'fuga',
  'casa', 'sótano', 'sotano', 'cocina', 'baño', 'bano', 'se', 'rompió', 'rompio', 'reventó', 'revento', 'calle', 'urgente',
  'mañana', 'manana', 'hoy', 'número', 'numero', 'mensaje', 'el', 'la', 'los', 'las', 'del', 'que', 'muy', 'pero', 'necesito',
  'ayuda', 'calefacción', 'calefaccion', 'fregadero', 'inodoro', 'tapado', 'prisa', 'cuando', 'pueda', 'puede', 'usted',
]);

/** Words that mark a voicemail as English, so a borrowed "hola" or a Spanish street name does not flip it. */
const ENGLISH_MARKERS = new Set([
  'the', 'is', 'my', 'and', 'this', 'please', 'call', 'me', 'back', 'at', 'it', 'we', 'our', 'have', 'thanks', 'thank', 'you',
  'water', 'heater', 'name', 'can', 'just', 'there', 'with', 'from', 'of', 'to',
]);

const words = (text: string) => text.toLowerCase().match(/[a-záéíóúñü']+/g) ?? [];

/** True when the voicemail is mostly Spanish: at least three Spanish marker words, and more than English ones. */
export function isSpanish(text: string): boolean {
  let es = 0;
  let en = 0;
  for (const w of words(text)) {
    if (SPANISH_MARKERS.has(w)) es++;
    if (ENGLISH_MARKERS.has(w)) en++;
  }
  return es >= 3 && es > en;
}

/**
 * Spanish trade phrases and their English equivalents, longest and most specific first. Phrases end
 * in a lookahead rather than \b, because \b does not see an accented letter as part of a word.
 */
const GLOSSARY: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:me llamo|mi nombre es|habla|soy)\s+/gi, 'my name is '],
  [/\bcalentador(?: de agua)?(?![a-záéíóúñü])/gi, 'water heater'],
  [/\bno hay agua caliente|sin agua caliente(?![a-záéíóúñü])/gi, 'no hot water'],
  [/\bse (?:rompió|rompio|reventó|revento)(?![a-záéíóúñü])/gi, 'burst'],
  [/\b(?:hay )?agua por todas partes|inundaci[oó]n|inundad[oa](?![a-záéíóúñü])/gi, 'water everywhere'],
  [/\b(?:hay )?una fuga\b|\bfuga\b|\bgotea(?![a-záéíóúñü])/gi, 'leaking'],
  [/\bolor a gas|huele a gas(?![a-záéíóúñü])/gi, 'gas smell'],
  [/\b(?:no hay|sin|no tenemos) calefacci[oó]n\b|\bse apag[oó] la calefacci[oó]n(?![a-záéíóúñü])/gi, 'no heat'],
  [/\b(?:el )?(?:aire acondicionado|aire) no enfr[ií]a(?![a-záéíóúñü])/gi, 'air conditioner not cooling'],
  [/\bsecadora(?![a-záéíóúñü])/gi, 'dryer'],
  [/\blavadora(?![a-záéíóúñü])/gi, 'washer'],
  [/\blavaplatos|lavavajillas(?![a-záéíóúñü])/gi, 'dishwasher'],
  [/\brefrigerador|nevera(?![a-záéíóúñü])/gi, 'fridge'],
  [/\bno calienta|no seca(?![a-záéíóúñü])/gi, 'not heating'],
  [/\bhace ruido|hace mucho ruido(?![a-záéíóúñü])/gi, 'making noise'],
  [/\b(?:fregadero|lavabo|desag[uü]e)\s+(?:está\s+|esta\s+)?tapad[oa](?![a-záéíóúñü])/gi, 'clogged drain'],
  [/\binodoro(?![a-záéíóúñü])/gi, 'toilet'],
  [/\btapad[oa](?![a-záéíóúñü])/gi, 'clogged'],
  [/\bchispas?(?![a-záéíóúñü])/gi, 'sparks'],
  [/\bbeb[eé](?![a-záéíóúñü])/gi, 'baby'],
  [/\bsin prisa|no hay prisa|no es urgente|cuando pueda(?![a-záéíóúñü])/gi, 'no rush'],
  [/\blo antes posible|cuanto antes|urgente(?![a-záéíóúñü])/gi, 'asap'],
  [/\bhoy(?![a-záéíóúñü])/gi, 'today'],
  [/\bmañana|manana(?![a-záéíóúñü])/gi, 'tomorrow'],
];

/** Rewrites the trade phrases the rules look for into English; names, numbers and addresses pass through. */
export function spanishForRules(text: string): string {
  return GLOSSARY.reduce((out, [re, en]) => out.replace(re, en), text);
}
