/**
 * Share payload v1 — the contract with the app (ai_context/API_SPEC.md).
 * Hand-written validator: small, fast (10 ms CPU budget) and strict.
 */

export const PAYLOAD_SCHEMA_VERSION = 1;
export const MAX_BODY_BYTES = 1024 * 1024;

export const SUPPORTED_LANGUAGES = ['en', 'pl', 'es', 'de', 'fr', 'uk', 'hi', 'id'] as const;
export const ADVANCEMENT_LEVELS = ['fast', 'normal', 'exact'] as const;

export const LIMITS = {
  title: 120,
  subTopics: 150,
  subTopicTitle: 200,
  content: 20_000,
  questions: 30,
  question: 500,
  answer: 300,
  wrongAnswers: 6,
} as const;

export interface QuestionV1 {
  question: string;
  right_answer: string;
  wrong_answers: string[];
}

export interface SubTopicV1 {
  title: string;
  content: string;
  questions: QuestionV1[];
}

export interface PayloadV1 {
  schema: 1;
  title: string;
  /**
   * Optional first name of the person sharing, shown on the landing page as
   * "<name> shared a topic with you!". Free text typed by the user in the app —
   * never an account id. Absent on every payload created before this field
   * existed, so the landing page must always have a nameless fallback.
   */
  language: (typeof SUPPORTED_LANGUAGES)[number];
  advancement_level: (typeof ADVANCEMENT_LEVELS)[number];
  sub_topics: SubTopicV1[];
}

export interface Issue {
  path: string;
  problem: string;
}

import { redactContacts, hasProfanity } from './screen';

export type ValidationResult =
  | { ok: true; payload: PayloadV1; subTopicCount: number; questionCount: number; redactions: number }
  | { ok: false; error: 'invalid_payload' | 'unsupported_schema' | 'title_not_allowed'; issues: Issue[] };

const MAX_ISSUES = 20;

// C0/C1 control characters except \t and \n.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** Multi-line text: keeps newlines, collapses runs of 4+ newlines to 3. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** Single-line text: all whitespace runs become one space. */
export function normalizeLine(value: string): string {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Checker {
  issues: Issue[] = [];

  redactions = 0;

  fail(path: string, problem: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ path, problem });
  }

  keys(obj: Record<string, unknown>, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) this.fail(path ? `${path}.${key}` : key, 'unknown field');
    }
  }

  text(value: unknown, path: string, max: number, multiline: boolean): string {
    if (typeof value !== 'string') {
      this.fail(path, 'must be a string');
      return '';
    }
    const normalized = multiline ? normalizeText(value) : normalizeLine(value);
    if (normalized.length === 0) this.fail(path, 'must not be empty');
    else if (normalized.length > max) this.fail(path, `must be at most ${max} characters`);
    // Contact details never reach storage. Silent by design — see screen.ts.
    const { text, redacted } = redactContacts(normalized);
    if (redacted) this.redactions += 1;
    return text;
  }

  list(value: unknown, path: string, min: number, max: number): unknown[] {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array');
      return [];
    }
    if (value.length < min || value.length > max) {
      this.fail(path, `must have ${min}..${max} items`);
      return value.length > max ? value.slice(0, max) : value;
    }
    return value;
  }
}

export function validatePayload(input: unknown): ValidationResult {
  const c = new Checker();

  if (!isPlainObject(input)) {
    return { ok: false, error: 'invalid_payload', issues: [{ path: '', problem: 'must be an object' }] };
  }

  if (typeof input.schema === 'number' && Number.isInteger(input.schema) && input.schema > PAYLOAD_SCHEMA_VERSION) {
    return { ok: false, error: 'unsupported_schema', issues: [{ path: 'schema', problem: 'newer than this server' }] };
  }
  if (input.schema !== PAYLOAD_SCHEMA_VERSION) c.fail('schema', `must be ${PAYLOAD_SCHEMA_VERSION}`);

  c.keys(input, ['schema', 'title', 'language', 'advancement_level', 'sub_topics', 'sharer_name'], '');

  const title = c.text(input.title, 'title', LIMITS.title, false);

  // `sharer_name` was removed: publishing a child's first name on a public page
  // is personal data we have no basis to process, and the landing page has
  // always had a nameless headline. The key is still accepted so builds that
  // shipped with it keep working, but the value is dropped here and never
  // reaches storage or the page. Only a wrong type is an error.
  const rawName = input.sharer_name;
  if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') {
    c.fail('sharer_name', 'must be a string');
  }

  const language = input.language;
  if (typeof language !== 'string' || !(SUPPORTED_LANGUAGES as readonly string[]).includes(language)) {
    c.fail('language', `must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
  }

  const level = input.advancement_level;
  if (typeof level !== 'string' || !(ADVANCEMENT_LEVELS as readonly string[]).includes(level)) {
    c.fail('advancement_level', `must be one of ${ADVANCEMENT_LEVELS.join(', ')}`);
  }

  let questionCount = 0;
  const subTopics: SubTopicV1[] = [];
  c.list(input.sub_topics, 'sub_topics', 1, LIMITS.subTopics).forEach((raw, i) => {
    const path = `sub_topics[${i}]`;
    if (!isPlainObject(raw)) {
      c.fail(path, 'must be an object');
      return;
    }
    c.keys(raw, ['title', 'content', 'questions'], path);
    const questions: QuestionV1[] = [];
    c.list(raw.questions, `${path}.questions`, 1, LIMITS.questions).forEach((rawQ, j) => {
      const qPath = `${path}.questions[${j}]`;
      if (!isPlainObject(rawQ)) {
        c.fail(qPath, 'must be an object');
        return;
      }
      c.keys(rawQ, ['question', 'right_answer', 'wrong_answers'], qPath);
      questions.push({
        question: c.text(rawQ.question, `${qPath}.question`, LIMITS.question, true),
        right_answer: c.text(rawQ.right_answer, `${qPath}.right_answer`, LIMITS.answer, true),
        wrong_answers: c
          .list(rawQ.wrong_answers, `${qPath}.wrong_answers`, 1, LIMITS.wrongAnswers)
          .map((a, k) => c.text(a, `${qPath}.wrong_answers[${k}]`, LIMITS.answer, true)),
      });
    });
    questionCount += questions.length;
    subTopics.push({
      title: c.text(raw.title, `${path}.title`, LIMITS.subTopicTitle, false),
      content: c.text(raw.content, `${path}.content`, LIMITS.content, true),
      questions,
    });
  });

  if (c.issues.length > 0) return { ok: false, error: 'invalid_payload', issues: c.issues };

  // The title is the one field a person types by hand, so it is the one field
  // worth checking for profanity. Lesson bodies are AI-generated from a
  // textbook and are left alone on purpose (screen.ts explains why).
  if (hasProfanity(title)) {
    return { ok: false, error: 'title_not_allowed', issues: [{ path: 'title', problem: 'not allowed' }] };
  }

  return {
    ok: true,
    payload: {
      schema: 1,
      title,
      language: language as PayloadV1['language'],
      advancement_level: level as PayloadV1['advancement_level'],
      sub_topics: subTopics,
    },
    subTopicCount: subTopics.length,
    questionCount,
    redactions: c.redactions,
  };
}
