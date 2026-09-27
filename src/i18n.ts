/**
 * Landing page copy. Child-simple (8-year-old bar). Brand names stay untranslated.
 * Languages without an entry fall back to English — add the rest of the app's
 * languages (es, de, fr, uk, hi, id) here with native wording.
 */

export interface Strings {
  lang: string;
  sharedWithYou: string;
  sharedWithYouBy: (name: string) => string;
  lessons: (n: number) => string;
  questions: (n: number) => string;
  openInApp: string;
  /** "Open in" — the Studdly logotype image follows it inside the button. */
  openIn: string;
  googlePlay: string;
  appStore: string;
  /** Small first line on the store badges; the store name stays untranslated. */
  getItOn: string;
  downloadOnThe: string;
  installHint: string;
  learnInStuddly: string;
  validUntil: (date: string) => string;
  notFoundTitle: string;
  notFoundBody: string;
  goneTitle: string;
  goneBody: string;
  busyTitle: string;
  busyBody: string;
  errorBody: string;
  report: string;
  reportQuestion: string;
  reasons: Record<'inappropriate' | 'personal_data' | 'copyright' | 'spam' | 'other', string>;
  reportThanks: string;
  privacy: string;
}

/** Polish plural: 1 lekcja, 2–4 lekcje (not 12–14), 5+ lekcji. */
function plPlural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

const en: Strings = {
  lang: 'en',
  sharedWithYou: 'Someone shared a topic with you!',
  sharedWithYouBy: (name) => `${name} shared a topic with you!`,
  lessons: (n) => `${n} ${n === 1 ? 'lesson' : 'lessons'}`,
  questions: (n) => `${n} quiz ${n === 1 ? 'question' : 'questions'}`,
  openInApp: 'Open in Studdly',
  openIn: 'Open in',
  googlePlay: 'Get it on Google Play',
  appStore: 'Download on the App Store',
  getItOn: 'Get it on',
  downloadOnThe: 'Download on the',
  installHint: "Don't have Studdly yet? Install it, then tap the link again.",
  learnInStuddly: 'Learn it in Studdly',
  validUntil: (date) => `Link works until ${date}`,
  notFoundTitle: "We can't find this topic",
  notFoundBody: 'Check the link, or ask your friend to send it again.',
  goneTitle: "This link doesn't work anymore",
  goneBody: 'Ask your friend to share the topic again.',
  busyTitle: 'Just a moment',
  busyBody: 'Too many tries. Please try again in a minute.',
  errorBody: 'Something went wrong on our side. Please try again in a moment.',
  report: 'Report',
  reportQuestion: "What's wrong with this topic?",
  reasons: {
    inappropriate: 'Not okay for kids',
    personal_data: 'Personal information',
    copyright: 'Copied without permission',
    spam: 'Spam',
    other: 'Something else',
  },
  reportThanks: "Thanks! We'll take a look.",
  privacy: 'Privacy policy',
};

const pl: Strings = {
  lang: 'pl',
  sharedWithYou: 'Ktoś udostępnił Ci temat!',
  sharedWithYouBy: (name) => `${name} udostępnił Ci temat!`,
  lessons: (n) => `${n} ${plPlural(n, 'lekcja', 'lekcje', 'lekcji')}`,
  questions: (n) => `${n} ${plPlural(n, 'pytanie', 'pytania', 'pytań')} w quizach`,
  openInApp: 'Otwórz w Studdly',
  openIn: 'Otwórz w',
  googlePlay: 'Pobierz z Google Play',
  appStore: 'Pobierz z App Store',
  getItOn: 'Pobierz z',
  downloadOnThe: 'Pobierz z',
  installHint: 'Nie masz jeszcze Studdly? Zainstaluj aplikację i kliknij link jeszcze raz.',
  learnInStuddly: 'Ucz się w Studdly',
  validUntil: (date) => `Link działa do ${date}`,
  notFoundTitle: 'Nie możemy znaleźć tego tematu',
  notFoundBody: 'Sprawdź link albo poproś znajomego, żeby wysłał go jeszcze raz.',
  goneTitle: 'Ten link już nie działa',
  goneBody: 'Poproś znajomego, żeby udostępnił temat jeszcze raz.',
  busyTitle: 'Chwileczkę',
  busyBody: 'Za dużo prób. Spróbuj ponownie za minutę.',
  errorBody: 'Coś poszło nie tak po naszej stronie. Spróbuj ponownie za chwilę.',
  report: 'Zgłoś',
  reportQuestion: 'Co jest nie tak z tym tematem?',
  reasons: {
    inappropriate: 'Nieodpowiednie dla dzieci',
    personal_data: 'Dane osobowe',
    copyright: 'Skopiowane bez zgody',
    spam: 'Spam',
    other: 'Coś innego',
  },
  reportThanks: 'Dziękujemy! Sprawdzimy to.',
  privacy: 'Polityka prywatności',
};

const ALL: Record<string, Strings> = { en, pl };

/** Best match from Accept-Language (q-values respected), English fallback. */
export function pickStrings(acceptLanguage: string | undefined): Strings {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { lang: tag.toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) {
    const strings = ALL[lang];
    if (strings) return strings;
  }
  return en;
}
