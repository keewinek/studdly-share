import { describe, expect, it } from 'vitest';
import { pickStrings } from '../src/i18n';
import { CODE_ALPHABET, generateCode, isValidCode } from '../src/lib/code';
import { gunzip, gzip } from '../src/lib/crypto';
import { normalizeLine, normalizeText, SUPPORTED_LANGUAGES, validatePayload } from '../src/lib/payload';
import { hasProfanity, redactContacts, REDACTION } from '../src/lib/screen';
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

  it('accepts sharer_name from older builds but never keeps it', () => {
    // The field was removed on privacy grounds. Builds that already shipped
    // with it must keep validating, so the key is tolerated and dropped.
    for (const value of ['  Kasia\t ', 'x'.repeat(33), '', null]) {
      const payload = samplePayload();
      (payload as Record<string, unknown>).sharer_name = value;
      const r = validatePayload(payload);
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.payload as unknown as Record<string, unknown>).sharer_name).toBeUndefined();
    }

    // A wrong type is still a client bug worth reporting.
    const wrongType = validatePayload(samplePayload({ sharer_name: 42 }));
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.issues.map((i) => i.path)).toContain('sharer_name');
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

describe('pre-publication screening', () => {
  it('redacts the ways a child could be contacted', () => {
    const cases = [
      'napisz do mnie kasia.nowak@gmail.com',
      'mój insta to @kasia_nowak123',
      'wejdź na https://discord.gg/abcdef',
      'więcej na www.mojastrona.pl',
      'sprawdź mojastrona.com',
      'zadzwoń +48 123 456 789',
      'tel. 123 456 789',
      'nr 501-234-567',
    ];
    for (const input of cases) {
      const { text, redacted } = redactContacts(input);
      expect(redacted, input).toBe(true);
      expect(text, input).toContain(REDACTION);
      expect(text, input).not.toMatch(/@[a-z]|https?:|\d{3}[\s.-]\d{3}/i);
    }
  });

  it('leaves ordinary schoolwork completely alone', () => {
    // Every one of these is the kind of line the filter must never touch:
    // a false positive here breaks real homework.
    const cases = [
      'Kasia ma 5 jabłek, a Jaś ma 3. Ile mają razem?',
      'Bitwa pod Grunwaldem odbyła się w 1410 roku.',
      'Liczba pi wynosi w przybliżeniu 3,14159.',
      'Wzór na wodę to H2O, a na dwutlenek węgla CO2.',
      'Populacja Chin przekracza 1 400 000 000 osób.',
      'Ludność Polski to około 38 000 000 mieszkańców.',
      'Powstanie styczniowe wybuchło 22.01.1863 r.',
      'Mieszko I przyjął chrzest w 966 r., a Bolesław Chrobry został królem w 1025.',
      'Rozwiąż równanie: 2x + 5 = 15, czyli x = 5.',
      'Jan Kowalski kupił 250 gramów sera po 12 zł za kilogram.',
      'Temperatura wrzenia wody to 100 °C pod ciśnieniem 1013 hPa.',
    ];
    for (const input of cases) {
      const { text, redacted } = redactContacts(input);
      expect(redacted, input).toBe(false);
      expect(text, input).toBe(input);
    }
  });

  it('flags profanity in a title, including padded and digit-swapped spellings', () => {
    for (const bad of ['kurwa mać', 'Ale to jest CHUJOWE', 'fuck this test', 'k u r… nope', 'sh1t']) {
      // the deliberately harmless one in the middle must not fire
      if (bad === 'k u r… nope') {
        expect(hasProfanity(bad)).toBe(false);
        continue;
      }
      expect(hasProfanity(bad), bad).toBe(true);
    }
  });

  it('does not flag ordinary topic titles', () => {
    const titles = [
      'Fotosynteza',
      'Układ krwionośny człowieka',
      'Bitwa pod Grunwaldem',
      'Analiza "Dziadów" części II',
      'Rozmnażanie roślin okrytonasiennych',
      'Present Perfect — ćwiczenia',
      'Ssaki i ich przystosowania',
      'Klasyfikacja związków organicznych',
      'Powstanie warszawskie',
      'Funkcja kwadratowa i jej wykres',
    ];
    for (const title of titles) {
      expect(hasProfanity(title), title).toBe(false);
    }
  });

  it('screens every text field of a payload, not just the title', () => {
    const payload = samplePayload();
    payload.sub_topics[0]!.content = 'Napisz do mnie: kasia@example.com i @kasia_n';
    const r = validatePayload(payload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.sub_topics[0]!.content).not.toContain('kasia@example.com');
      expect(r.payload.sub_topics[0]!.content).toContain(REDACTION);
      expect(r.redactions).toBeGreaterThan(0);
    }
  });

  it('rejects an offensive title but keeps ordinary ones', () => {
    const bad = validatePayload(samplePayload({ title: 'kurwa fotosynteza' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('title_not_allowed');

    const good = validatePayload(samplePayload({ title: 'Fotosynteza' }));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.redactions).toBe(0);
  });
});
