/**
 * Pre-publication screening.
 *
 * A share is a public page written by a child out of their own notes, so two
 * things must not reach it: a way to contact the child, and a title someone
 * typed to be offensive.
 *
 * The design goal is that an ordinary user never notices this file exists.
 * Therefore:
 *
 * - **Contact details are redacted, not rejected.** The share still succeeds;
 *   the address, number, handle or link is replaced with `[…]`. Blocking the
 *   upload would punish a child for what the OCR picked up off a page they
 *   photographed, and the point is to keep the detail off the public page, not
 *   to stop the schoolwork.
 * - **Only the title is checked for profanity**, because the title is the one
 *   field a person types by hand. Lesson bodies are AI-generated from a
 *   textbook, so a word list there would mostly fire on biology, history and
 *   literature — the cost of a false positive lands on real homework.
 * - **Names are not matched at all.** A history topic is full of names, a maths
 *   problem is "Kasia ma 5 jabłek", and a name list would break both.
 *
 * Redaction is also what keeps the service inside the COPPA carve-out in
 * 16 CFR §312.2: an operator has not "collected" personal information if it
 * takes reasonable measures to delete it from a child's postings before they
 * are made public.
 */

/** What a redacted span is replaced with. Language-neutral on purpose. */
export const REDACTION = '[…]';

// Order matters: e-mails before handles and links, so the local part and the
// domain are consumed as one span rather than matched piecemeal.
const PATTERNS: readonly RegExp[] = [
  // me@example.com
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
  // http(s)://… and www.…
  /\b(?:https?:\/\/|www\.)[^\s<>"')]+/giu,
  // bare domains people actually paste; a plain "3.14" or "itd." cannot match
  /\b[\p{L}\p{N}-]{2,}\.(?:com|net|org|pl|eu|io|me|gg|tv|xyz|app|dev|info|site|link)\b/giu,
  // +48 123 456 789 / +1-555-0100
  /\+\d{1,3}[\s.-]?(?:\d[\s.-]?){6,12}\d/gu,
  // "tel. 123 456 789". A bare nine-digit group is deliberately NOT matched:
  // "100 000 000" is a population in a geography lesson far more often than it
  // is a phone number, and redacting schoolwork is worse than missing a number
  // the report button can still catch.
  /(?:tel|telefon|kom|komórka|phone|numer|nr)\.?[\s.:]*\+?\d[\d\s.-]{5,14}\d/giu,
  // @handle, but not an e-mail local part (handled above) or a bare "@"
  /(?<![\p{L}\p{N}._%+-])@[\p{L}\p{N}_.]{3,30}\b/gu,
];

/**
 * Replaces contact details in [value] with [REDACTION].
 *
 * Returns the text unchanged (same reference semantics as the input) when
 * nothing matched, so callers can cheaply tell whether anything was touched.
 */
export function redactContacts(value: string): { text: string; redacted: boolean } {
  let text = value;
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, REDACTION);
  }
  // Collapse runs a single detail can leave behind, e.g. "[…] […]" from a
  // "name@host tel. 123-456-789" pair sitting next to each other.
  text = text.replace(/(?:\[…\][\s.,;:-]*){2,}/gu, `${REDACTION} `).trim();
  return { text, redacted: text !== value };
}

/**
 * Unambiguous profanity and slurs, for titles only.
 *
 * Deliberately short. Every entry has to be a word that cannot plausibly appear
 * in a school topic title — anything borderline ("debil", "idiota", anatomical
 * terms) is left out, because a false positive here blocks a child's homework
 * and a false negative is caught by the report button.
 *
 * Stems are matched with a word boundary at the start only, so Polish
 * inflection ("kurwa", "kurwy", "kurwie") is covered by one entry.
 */
const BANNED_STEMS: readonly string[] = [
  // pl
  'kurwa',
  'kurwy',
  'chuj',
  'huj',
  'jeban',
  'jebac',
  'jebać',
  'pierdol',
  'spierdal',
  'wypierdal',
  'pizda',
  'cipa',
  'skurwiel',
  'skurwysyn',
  'zjeb',
  'debilu',
  // en
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'asshole',
  'motherfuck',
  'whore',
  'slut',
  // slurs, any language
  'nigger',
  'nigga',
  'faggot',
  'pedał',
  'pedal',
  'ciapat',
];

/** Whether [value] contains a word from [BANNED_STEMS]. Case-insensitive. */
export function hasProfanity(value: string): boolean {
  // Strip combining marks so "kúrwa" and "kurwa" compare the same, and fold
  // the handful of look-alike characters people reach for first.
  const normalized = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's');

  return BANNED_STEMS.some((stem) => {
    const folded = stem.normalize('NFKD').replace(/\p{M}/gu, '');
    const escaped = folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, 'u').test(normalized);
  });
}
