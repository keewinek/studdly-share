import { describe, expect, it } from 'vitest';
import { pickStrings } from '../src/i18n';
import { CODE_ALPHABET, generateCode, isValidCode } from '../src/lib/code';
import { gunzip, gzip } from '../src/lib/crypto';
import { normalizeLine, normalizeText, SUPPORTED_LANGUAGES, validatePayload } from '../src/lib/payload';
import { samplePayload } from './helpers';

describe('share codes', () => {
  it('generates 5-char codes from the no-vowel alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(5);
      expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it('accepts 5 and 6 chars, rejects vowels, look-alikes and other lengths', () => {
    expect(isValidCode('k4Rf8')).toBe(true);
    expect(isValidCode('k4Rf8b')).toBe(true);
    expect(isValidCode('k4Rf')).toBe(false);
    expect(isValidCode('k4Rf8bc')).toBe(false);
    expect(isValidCode('e4Rf8')).toBe(false); // vowel
    expect(isValidCode('k0Rf8')).toBe(false); // zero
    expect(isValidCode('k1Rf8')).toBe(false); // one
    expect(isValidCode('klRf8')).toBe(false); // lowercase L
    expect(isValidCode('api12')).toBe(false);
  });
});

describe('payload validation', () => {
  it('accepts a valid payload and counts items', () => {
    const r = validatePayload(samplePayload());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.subTopicCount).toBe(2);
      expect(r.questionCount).toBe(3);
    }
  });

  it('rejects unknown fields, including private app data', () => {
    const r = validatePayload(samplePayload({ pages: [{ text: 'OCR' }], user_name: 'Kasia' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['pages', 'user_name']));
  });

  it('accepts an optional sharer_name, normalized and length-capped', () => {
    const ok = validatePayload(samplePayload({ sharer_name: '  Kasia\t ' }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payload.sharer_name).toBe('Kasia');

    const long = validatePayload(samplePayload({ sharer_name: 'x'.repeat(33) }));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.issues.map((i) => i.path)).toContain('sharer_name');

    const wrongType = validatePayload(samplePayload({ sharer_name: 42 }));
    expect(wrongType.ok).toBe(false);
  });

  it('treats a missing, null or blank sharer_name as no name', () => {
    for (const value of [undefined, null, '   ']) {
      const payload = samplePayload();
      if (value !== undefined) (payload as Record<string, unknown>).sharer_name = value;
      const r = validatePayload(payload);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.payload.sharer_name).toBeUndefined();
    }
  });

  it('flags newer schemas separately', () => {
    const r = validatePayload(samplePayload({ schema: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported_schema');
  });

  it('enforces limits and enums', () => {
    const bad = samplePayload({ title: 'x'.repeat(121), language: 'xx', advancement_level: 'turbo', sub_topics: [] });
    const r = validatePayload(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.path)).toEqual(
        expect.arrayContaining(['title', 'language', 'advancement_level', 'sub_topics']),
      );
    }
  });

  it('rejects empty strings after trimming', () => {
    const p = samplePayload();
    p.sub_topics[0]!.questions[0]!.right_answer = '   ';
    const r = validatePayload(p);
    expect(r.ok).toBe(false);
  });

  it('normalizes text', () => {
    expect(normalizeText('  a\u0000b\r\n\n\n\n\nc  ')).toBe('ab\n\n\nc');
    expect(normalizeLine(' Tytuł \n  tematu\t ')).toBe('Tytuł tematu');
  });
});

describe('gzip helpers', () => {
  it('round-trips unicode', async () => {
    const text = JSON.stringify(samplePayload());
    expect(await gunzip(await gzip(text))).toBe(text);
  });
});

describe('landing language', () => {
  it('picks the best supported language', () => {
    expect(pickStrings('pl-PL,pl;q=0.9,en;q=0.8').lang).toBe('pl');
    expect(pickStrings('de-DE,en;q=0.5').lang).toBe('de');
    expect(pickStrings('en;q=0.3,pl;q=0.9').lang).toBe('pl');
    expect(pickStrings(undefined).lang).toBe('en');
    // Unsupported language still falls back to English.
    expect(pickStrings('ja-JP,ja;q=0.9').lang).toBe('en');
  });

  it('has copy for every language the app can send', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const t = pickStrings(lang);
      expect(t.lang).toBe(lang);
      // Spot-check the strings the landing page cannot render without.
      expect(t.sharedWithYouBy('Kasia')).toContain('Kasia');
      expect(t.lessons(1)).toContain('1');
      expect(t.lessons(5)).toContain('5');
      expect(t.questions(2)).toContain('2');
      expect(t.openIn.length).toBeGreaterThan(0);
      expect(t.getItOn.length).toBeGreaterThan(0);
      expect(t.downloadOnThe.length).toBeGreaterThan(0);
      expect(t.validUntil('1.1.2030')).toContain('1.1.2030');
      expect(Object.values(t.reasons).every((r) => r.length > 0)).toBe(true);
    }
  });
});
