import { lexNumbers, spokenDigitsToText, tokenize } from './spoken-numbers';
import type { JobCategory, Urgency, VoicemailExtraction } from './types';

/**
 * Rule-based voicemail extraction: the free, deterministic default. The Bedrock extractor returns
 * the same shape, and falls back to these rules if the model output fails validation.
 */

const NOT_NAMES = new Set([
  'calling', 'about', 'just', 'so', 'not', 'trying', 'looking', 'having', 'the', 'a', 'at', 'in', 'here',
  'hoping', 'wondering', 'your', 'sorry', 'hi', 'hey', 'hello', 'um', 'uh', 'from', 'over', 'out', 'really',
  'sure', 'getting', 'going', 'again', 'still', 'me', 'my', 'is', 'and', 'it', 'water', 'no',
]);

const CATEGORIES: ReadonlyArray<{ category: JobCategory; label: string; pattern: RegExp }> = [
  { category: 'water-heater', label: 'Water heater', pattern: /\b(water heater|hot water heater|no hot water|tankless)\b/i },
  { category: 'drain', label: 'Toilet', pattern: /\btoilets?\b/i },
  { category: 'leak', label: 'Faucet', pattern: /\b(faucet|tap|spigot)\b/i },
  { category: 'drain', label: 'Clogged drain', pattern: /\b(clog(ged)?|backing up|backed up|sewer|garbage disposal|(sink|tub|shower|floor|basement|kitchen|bathroom) drain|drains? (is|are|line|pipe))\b/i },
  { category: 'leak', label: 'Leak', pattern: /\b(leak(ing|s)?|burst|pipe|flood(ing|ed)?|dripping|water everywhere)\b/i },
  { category: 'appliance', label: 'Appliance repair', pattern: /\b(dryer|washer|washing machine|dishwasher|fridge|refrigerator|freezer|oven|stove|range|microwave|ice maker)\b/i },
  { category: 'heating', label: 'Heating', pattern: /\b(furnace|no heat|heat|heater|boiler|heat pump|thermostat)\b/i },
  { category: 'cooling', label: 'Air conditioning', pattern: /\b(a\/?c|air condition(er|ing)?|cooling|not cooling)\b/i },
  { category: 'roofing', label: 'Roofing', pattern: /\b(roof|shingles?|gutters?|flashing|skylight)\b/i },
  { category: 'electrical', label: 'Electrical', pattern: /\b(outlet|breaker|sparks?|sparking|wiring|lights? flicker)\b/i },
];

const APPLIANCES = /\b(dryer|washer|washing machine|dishwasher|fridge|refrigerator|freezer|oven|stove|range|microwave|ice maker)\b/i;

/** The heat itself has failed: "furnace quit", "heat went out", "boiler won't turn on". Never a dryer or water heater. */
const HEAT_OUT =
  /\b(no heat|(furnace|boiler|heat pump)\s+(just\s+)?(quit|died|stopped|went out|is out|gave out|shut off|(is |isn'?t |not |won'?t )(working|heating|turn(ing)? on|kick(ing)? on|start(ing)?))|(the )?heat('?s| has)? (just )?(went out|is out|out|quit|stopped|isn'?t working|is not working|won'?t (come|turn) on))\b/i;
/** Freezing weather or frozen pipes, which turn a heating call into a burst-pipe call. */
const FREEZING =
  /\b(freezing|froze|frozen|below zero|zero degrees|single digits|(ten|fifteen|twenty|twenty[- ]\w+|thirty|thirty[- ]\w+|\d{1,2}) degrees)\b/i;
/** Someone in the house who cannot ride out a cold night or a day without hot water. */
const VULNERABLE =
  /\b(bab(y|ies)|infant|newborn|toddler|elderly|senior|grandm(a|other)|grandp(a|arent)|oxygen|on dialysis|just had surgery|disabled|(is|she'?s|he'?s) (eighty|ninety)|(eighty|ninety)([- ]\w+)? years? old)\b/i;
const NO_HOT_WATER = /\b(no hot water|without hot water|hot water (is )?(out|gone)|water heater (is )?(leaking|dripping))\b/i;

const SYMPTOMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bburst\b/i, 'burst'],
  [/\b(flood(ing|ed)?|water (all over|everywhere))\b/i, 'flooding'],
  [/\bleak(ing|s)?\b/i, 'leaking'],
  [/\b(backing|backed) up\b/i, 'backing up'],
  [/\bclog(ged)?\b/i, 'clogged'],
  [/\b(keeps? running|won'?t stop running|runs (all the time|constantly))\b/i, 'keeps running'],
  [/\boverflow(ing|ed|s)?\b/i, 'overflowing'],
  [/\bno hot water\b/i, 'no hot water'],
  [HEAT_OUT, 'no heat'],
  [FREEZING, 'freezing'],
  [/\b(not|won'?t|isn'?t) (heating|drying)|taking forever to dry\b/i, 'not heating'],
  [/\bnot cooling\b/i, 'not cooling'],
  [/\b(noise|noisy|squeal(ing)?|grinding|banging)\b/i, 'making noise'],
  [/\b(won'?t|doesn'?t|not) (start|turn on|spin|drain)\b/i, "won't run"],
  [/\bsmell(s)? (like )?gas|gas smell\b/i, 'gas smell'],
  [/\bspark(s|ing)?\b/i, 'sparking'],
];

const EMERGENCY = /\b(burst|flood(ing|ed)?|water (all over|everywhere)|gushing|no heat|smell(s)? (like )?gas|gas smell|carbon monoxide|spark(s|ed|ing)?|smoke|sewage|emergency|ceiling is leaking|coming through the ceiling)\b/i;
const SOON = /\b(today|tonight|tomorrow|asap|a\.s\.a\.p|as soon as|urgent(ly)?|right away|quickly|this week|soon)\b/i;
const NO_RUSH = /\b(no rush|whenever|next week|not urgent|no hurry|when you get a chance)\b/i;

const STREET_SUFFIX =
  '(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Way|Boulevard|Blvd|Place|Pl|Terrace|Ter|Circle|Cir|Trail|Trl|Parkway|Pkwy|Highway|Hwy|Row|Loop|Run|Pike)';

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

const NAME = "[A-Z][a-z'\u2019-]+";
const CAPITALISED_PATTERNS = [
  new RegExp(`\\b(?:[Mm]y name(?:'s| is)|[Tt]his is|[Ii]t's|[Ii]t is|I'm|I am|[Nn]ame's)\\s+(${NAME})(?:\\s+(${NAME}))?`, 'g'),
  new RegExp(`\\b(${NAME})(?:\\s+(${NAME}))?\\s+here\\b`, 'g'),
];
const LOWERCASE_PATTERN = /\b(?:my name is|this is)\s+([a-z'\u2019-]+)(?:\s+([a-z'\u2019-]+))?/gi;

function nameFrom(first: string, second: string | undefined): string | null {
  if (NOT_NAMES.has(first.toLowerCase())) return null;
  const surname = second && !NOT_NAMES.has(second.toLowerCase()) ? second : null;
  return surname ? `${cap(first)} ${cap(surname)}` : cap(first);
}

/** Finds the caller's name from "this is ...", "my name is ..." or "... here". */
export function extractName(text: string): string | null {
  for (const pattern of [...CAPITALISED_PATTERNS, LOWERCASE_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      const name = nameFrom(match[1]!, match[2]);
      if (name) return name;
    }
  }
  return null;
}

/** Formats 10 digits as (614) 555-0134. */
export function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (d.length !== 10) return digits;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Converts to E.164 for SMS: (614) 555-0134 -> +16145550134. */
export function toE164(phone: string): string | null {
  const d = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `+1${d}` : null;
}

export function extractCallback(text: string, defaultAreaCode: string): string | null {
  const normalised = spokenDigitsToText(text);
  const full = normalised.match(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  if (full) return formatPhone(`${full[1]}${full[2]}${full[3]}`);
  const local = normalised.match(/\b(\d{3})[\s.-]?(\d{4})\b/);
  if (local) return formatPhone(`${defaultAreaCode}${local[1]}${local[2]}`);
  return null;
}

/** Rewrites spoken house numbers ("nineteen Cobweb Lane") into digits so the address pattern can match. */
function houseNumbersToDigits(text: string): string {
  return text.replace(
    /\b((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|oh)[\s-]+)+)(?=[A-Z][a-z]+\s)/g,
    (phrase) => {
      const tokens = lexNumbers(tokenize(phrase));
      const digits = tokens.map((t) => (t.type === 'num' ? (t.count ?? (t.priceCents[0] ?? 0) / 100) : '')).join('');
      return digits ? `${digits} ` : phrase;
    },
  );
}

export function extractAddress(text: string): string | null {
  const prepared = houseNumbersToDigits(text);
  const re = new RegExp(
    `\\b(\\d{1,5})\\s+((?:[A-Z][a-z]+\\s+){1,3})${STREET_SUFFIX}\\b\\.?(?:,?\\s+(?:apartment|apt|unit|suite)\\s+(\\w+))?`,
  );
  const m = prepared.match(re);
  if (!m) return null;
  const unit = m[4] ? `, Unit ${m[4].toUpperCase()}` : '';
  return `${m[1]} ${m[2]!.trim()} ${m[3]}${unit}`;
}

export function classifyJob(text: string): { category: JobCategory; job: string } {
  const found = CATEGORIES.find((c) => c.pattern.test(text));
  const category = found?.category ?? 'general';
  let label = found?.label ?? 'General repair';
  if (category === 'appliance') {
    const appliance = text.match(APPLIANCES)?.[1];
    if (appliance) label = `${cap(appliance)} repair`;
  }
  const symptoms = SYMPTOMS.filter(([re]) => re.test(text))
    .map(([, s]) => s)
    .filter((s) => !label.toLowerCase().includes(s));
  const unique = [...new Set(symptoms)].slice(0, 2);
  const job = unique.length > 0 ? `${label.replace(/ repair$/, '')}: ${unique.join(', ')}` : label;
  return { category, job };
}

/**
 * Urgency, most serious first. Lost heat is an emergency on its own; freezing weather or a baby,
 * an elderly person or someone medically fragile in the house makes a heat, cooling or hot-water
 * problem an emergency too. No hot water is never "no rush".
 */
export function classifyUrgency(text: string): Urgency {
  if (EMERGENCY.test(text) || HEAT_OUT.test(text)) return 'emergency';
  const comfort = /\b(furnace|heat|heating|heater|boiler|heat pump|a\/?c|air condition(er|ing)?|cooling|hot water|water heater|pipes?)\b/i.test(text);
  if (comfort && FREEZING.test(text)) return 'emergency';
  if (comfort && VULNERABLE.test(text)) return 'emergency';
  if (NO_HOT_WATER.test(text)) return 'soon';
  if (NO_RUSH.test(text)) return 'routine';
  if (SOON.test(text)) return 'soon';
  return 'routine';
}

const URGENCY_PHRASE: Record<Urgency, string> = {
  emergency: 'Emergency, call back now.',
  soon: 'Wants it handled in the next day or two.',
  routine: 'No rush, book any open slot.',
};

export interface RuleContext {
  callerId: string;
  defaultAreaCode: string;
}

export function extractWithRules(transcript: string, ctx: RuleContext): VoicemailExtraction {
  const callerName = extractName(transcript);
  const callbackNumber = extractCallback(transcript, ctx.defaultAreaCode) ?? formatPhone(ctx.callerId);
  const address = extractAddress(transcript);
  const { category, job } = classifyJob(transcript);
  const urgency = classifyUrgency(transcript);
  const who = callerName ?? 'Unknown caller';
  const where = address ? ` at ${address}` : '';
  return {
    callerName,
    callbackNumber,
    address,
    job,
    jobCategory: category,
    urgency,
    summary: `${who}${where}. ${job}. ${URGENCY_PHRASE[urgency]}`,
    source: 'rules',
  };
}

/** Words that carry no request on their own: greetings, fillers and hang-up noise. */
const EMPTY_WORDS = new Set([
  'hello', 'hi', 'hey', 'hallo', 'uh', 'um', 'umm', 'uhh', 'er', 'ah', 'oh', 'hmm', 'mm', 'yes', 'yeah', 'no', 'ok',
  'okay', 'is', 'anyone', 'anybody', 'there', 'nobody', 'somebody', 'someone', 'here', 'what', 'who', 'this', 'that',
  'the', 'a', 'it', 'its', "it's", 'i', 'guess', 'sorry', 'wrong', 'number', 'never', 'mind', 'nevermind', 'bye',
  'goodbye', 'thanks', 'thank', 'you', 'testing', 'test', 'can', 'hear', 'me', 'machine', 'answering', 'ugh', 'huh',
]);

/** The fewest meaningful words a message needs before it earns a text-back when nothing else was found. */
export const MIN_MEANINGFUL_WORDS = 4;

/**
 * Decides whether a voicemail is worth texting back. A hang-up, a pocket dial or "hello? anyone
 * there?" is filed for the owner but gets no text, so the machine never texts a stranger a booking
 * link for nothing. Returns the reason to skip, or null to text.
 */
export function emptyMessageReason(transcript: string, extraction: VoicemailExtraction): string | null {
  if (extraction.callerName || extraction.address || extraction.jobCategory !== 'general') return null;
  const meaningful = (transcript.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => !EMPTY_WORDS.has(w));
  if (meaningful.length >= MIN_MEANINGFUL_WORDS) return null;
  return 'No text sent: the message had no name, address or job in it.';
}
