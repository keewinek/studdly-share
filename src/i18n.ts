/**
 * Landing page copy. Child-simple (8-year-old bar). Brand names stay untranslated.
 * Covers every language the app ships (see SUPPORTED_LANGUAGES in lib/payload.ts);
 * anything else falls back to English. A new app language needs an entry here too.
 */

export interface Strings {
  lang: string;
  sharedWithYou: string;
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
  terms: string;
  contact: string;
}

/** Polish plural: 1 lekcja, 2–4 lekcje (not 12–14), 5+ lekcji. */
function plPlural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

/** Ukrainian plural: 1 урок, 2–4 уроки (not 12–14), 5+ уроків. */
function ukPlural(n: number, one: string, few: string, many: string): string {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

const en: Strings = {
  lang: 'en',
  sharedWithYou: 'Someone shared a topic with you!',
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
  terms: 'Terms of use',
  contact: 'Contact us',
};

const pl: Strings = {
  lang: 'pl',
  sharedWithYou: 'Ktoś udostępnił Ci temat!',
  // Present tense, so it is right whether the sender is a boy or a girl.
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
  terms: 'Regulamin',
  contact: 'Kontakt',
};


const es: Strings = {
  lang: 'es',
  sharedWithYou: '\u00a1Alguien te ha compartido un tema!',
  lessons: (n) => `${n} ${n === 1 ? 'lecci\u00f3n' : 'lecciones'}`,
  questions: (n) => `${n} ${n === 1 ? 'pregunta' : 'preguntas'} de quiz`,
  openInApp: 'Abrir en Studdly',
  openIn: 'Abrir en',
  googlePlay: 'Cons\u00edguelo en Google Play',
  appStore: 'Desc\u00e1rgalo en el App Store',
  getItOn: 'Cons\u00edguelo en',
  downloadOnThe: 'Desc\u00e1rgalo en',
  installHint: '\u00bfA\u00fan no tienes Studdly? Instalalo y vuelve a tocar el enlace.',
  learnInStuddly: 'Apr\u00e9ndelo en Studdly',
  validUntil: (date) => `El enlace funciona hasta el ${date}`,
  notFoundTitle: 'No encontramos este tema',
  notFoundBody: 'Revisa el enlace o pide que te lo env\u00eden otra vez.',
  goneTitle: 'Este enlace ya no funciona',
  goneBody: 'Pide a tu amigo que comparta el tema otra vez.',
  busyTitle: 'Un momento',
  busyBody: 'Demasiados intentos. Int\u00e9ntalo de nuevo en un minuto.',
  errorBody: 'Algo sali\u00f3 mal por nuestra parte. Int\u00e9ntalo de nuevo en un momento.',
  report: 'Reportar',
  reportQuestion: '\u00bfQu\u00e9 pasa con este tema?',
  reasons: {
    inappropriate: 'No es apto para ni\u00f1os',
    personal_data: 'Datos personales',
    copyright: 'Copiado sin permiso',
    spam: 'Spam',
    other: 'Otra cosa',
  },
  reportThanks: '\u00a1Gracias! Lo revisaremos.',
  privacy: 'Pol\u00edtica de privacidad',
  terms: 'Condiciones de uso',
  contact: 'Contacto',
};

const de: Strings = {
  lang: 'de',
  sharedWithYou: 'Jemand hat ein Thema mit dir geteilt!',
  lessons: (n) => `${n} ${n === 1 ? 'Lektion' : 'Lektionen'}`,
  questions: (n) => `${n} ${n === 1 ? 'Quizfrage' : 'Quizfragen'}`,
  openInApp: 'In Studdly \u00f6ffnen',
  openIn: '\u00d6ffnen in',
  googlePlay: 'Jetzt bei Google Play',
  appStore: 'Laden im App Store',
  getItOn: 'Jetzt bei',
  downloadOnThe: 'Laden im',
  installHint: 'Du hast Studdly noch nicht? Installiere es und tippe den Link noch einmal an.',
  learnInStuddly: 'Lern es in Studdly',
  validUntil: (date) => `Der Link funktioniert bis ${date}`,
  notFoundTitle: 'Wir finden dieses Thema nicht',
  notFoundBody: 'Pr\u00fcfe den Link oder bitte um einen neuen.',
  goneTitle: 'Dieser Link funktioniert nicht mehr',
  goneBody: 'Bitte darum, das Thema noch einmal zu teilen.',
  busyTitle: 'Einen Moment',
  busyBody: 'Zu viele Versuche. Probiere es in einer Minute noch einmal.',
  errorBody: 'Bei uns ist etwas schiefgelaufen. Probiere es gleich noch einmal.',
  report: 'Melden',
  reportQuestion: 'Was stimmt mit diesem Thema nicht?',
  reasons: {
    inappropriate: 'Nicht f\u00fcr Kinder',
    personal_data: 'Pers\u00f6nliche Daten',
    copyright: 'Ohne Erlaubnis kopiert',
    spam: 'Spam',
    other: 'Etwas anderes',
  },
  reportThanks: 'Danke! Wir schauen es uns an.',
  privacy: 'Datenschutz',
  terms: 'Nutzungsbedingungen',
  contact: 'Kontakt',
};

const fr: Strings = {
  lang: 'fr',
  sharedWithYou: "Quelqu'un a partag\u00e9 un sujet avec toi\u202f!",
  lessons: (n) => `${n} ${n === 1 ? 'le\u00e7on' : 'le\u00e7ons'}`,
  questions: (n) => `${n} question${n === 1 ? '' : 's'} de quiz`,
  openInApp: 'Ouvrir dans Studdly',
  openIn: 'Ouvrir dans',
  googlePlay: 'Disponible sur Google Play',
  appStore: "T\u00e9l\u00e9charger dans l'App Store",
  getItOn: 'Disponible sur',
  downloadOnThe: 'T\u00e9l\u00e9charger dans',
  installHint: "Tu n'as pas encore Studdly\u202f? Installe l'appli, puis reclique sur le lien.",
  learnInStuddly: 'Apprends-le dans Studdly',
  validUntil: (date) => `Le lien marche jusqu'au ${date}`,
  notFoundTitle: 'On ne trouve pas ce sujet',
  notFoundBody: "V\u00e9rifie le lien ou demande qu'on te l'envoie encore.",
  goneTitle: 'Ce lien ne marche plus',
  goneBody: 'Demande \u00e0 ton ami de partager le sujet encore une fois.',
  busyTitle: 'Un instant',
  busyBody: "Trop d'essais. R\u00e9essaie dans une minute.",
  errorBody: 'Quelque chose a rat\u00e9 chez nous. R\u00e9essaie dans un instant.',
  report: 'Signaler',
  reportQuestion: 'Quel est le probl\u00e8me avec ce sujet\u202f?',
  reasons: {
    inappropriate: 'Pas pour les enfants',
    personal_data: 'Donn\u00e9es personnelles',
    copyright: 'Copi\u00e9 sans permission',
    spam: 'Spam',
    other: 'Autre chose',
  },
  reportThanks: 'Merci\u202f! On va regarder.',
  privacy: 'Confidentialit\u00e9',
  terms: 'Conditions d’utilisation',
  contact: 'Contact',
};

const uk: Strings = {
  lang: 'uk',
  sharedWithYou: '\u0425\u0442\u043e\u0441\u044c \u043f\u043e\u0434\u0456\u043b\u0438\u0432\u0441\u044f \u0437 \u0442\u043e\u0431\u043e\u044e \u0442\u0435\u043c\u043e\u044e!',
  // Present tense keeps it right for any gender.
  lessons: (n) => `${n} ${ukPlural(n, '\u0443\u0440\u043e\u043a', '\u0443\u0440\u043e\u043a\u0438', '\u0443\u0440\u043e\u043a\u0456\u0432')}`,
  questions: (n) => `${n} ${ukPlural(n, '\u043f\u0438\u0442\u0430\u043d\u043d\u044f', '\u043f\u0438\u0442\u0430\u043d\u043d\u044f', '\u043f\u0438\u0442\u0430\u043d\u044c')} \u0443 \u043a\u0432\u0456\u0437\u0430\u0445`,
  openInApp: '\u0412\u0456\u0434\u043a\u0440\u0438\u0442\u0438 \u0443 Studdly',
  openIn: '\u0412\u0456\u0434\u043a\u0440\u0438\u0442\u0438 \u0443',
  googlePlay: '\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u0437 Google Play',
  appStore: '\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u0437 App Store',
  getItOn: '\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u0437',
  downloadOnThe: '\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u0437',
  installHint: '\u0429\u0435 \u043d\u0435 \u043c\u0430\u0454\u0448 Studdly? \u0412\u0441\u0442\u0430\u043d\u043e\u0432\u0438 \u0437\u0430\u0441\u0442\u043e\u0441\u0443\u043d\u043e\u043a \u0456 \u043d\u0430\u0442\u0438\u0441\u043d\u0438 \u043f\u043e\u0441\u0438\u043b\u0430\u043d\u043d\u044f \u0449\u0435 \u0440\u0430\u0437.',
  learnInStuddly: '\u0412\u0438\u0432\u0447\u0438 \u0446\u0435 \u0443 Studdly',
  validUntil: (date) => `\u041f\u043e\u0441\u0438\u043b\u0430\u043d\u043d\u044f \u043f\u0440\u0430\u0446\u044e\u0454 \u0434\u043e ${date}`,
  notFoundTitle: '\u041d\u0435 \u043c\u043e\u0436\u0435\u043c\u043e \u0437\u043d\u0430\u0439\u0442\u0438 \u0446\u044e \u0442\u0435\u043c\u0443',
  notFoundBody: '\u041f\u0435\u0440\u0435\u0432\u0456\u0440 \u043f\u043e\u0441\u0438\u043b\u0430\u043d\u043d\u044f \u0430\u0431\u043e \u043f\u043e\u043f\u0440\u043e\u0441\u0438 \u043d\u0430\u0434\u0456\u0441\u043b\u0430\u0442\u0438 \u0439\u043e\u0433\u043e \u0449\u0435 \u0440\u0430\u0437.',
  goneTitle: '\u0426\u0435 \u043f\u043e\u0441\u0438\u043b\u0430\u043d\u043d\u044f \u0432\u0436\u0435 \u043d\u0435 \u043f\u0440\u0430\u0446\u044e\u0454',
  goneBody: '\u041f\u043e\u043f\u0440\u043e\u0441\u0438 \u043f\u043e\u0434\u0456\u043b\u0438\u0442\u0438\u0441\u044f \u0442\u0435\u043c\u043e\u044e \u0449\u0435 \u0440\u0430\u0437.',
  busyTitle: '\u0425\u0432\u0438\u043b\u0438\u043d\u043a\u0443',
  busyBody: '\u0417\u0430\u0431\u0430\u0433\u0430\u0442\u043e \u0441\u043f\u0440\u043e\u0431. \u0421\u043f\u0440\u043e\u0431\u0443\u0439 \u0449\u0435 \u0440\u0430\u0437 \u0437\u0430 \u0445\u0432\u0438\u043b\u0438\u043d\u0443.',
  errorBody: '\u0429\u043e\u0441\u044c \u043f\u0456\u0448\u043b\u043e \u043d\u0435 \u0442\u0430\u043a \u0443 \u043d\u0430\u0441. \u0421\u043f\u0440\u043e\u0431\u0443\u0439 \u0449\u0435 \u0440\u0430\u0437 \u0437\u0430 \u043c\u0438\u0442\u044c.',
  report: '\u041f\u043e\u0441\u043a\u0430\u0440\u0436\u0438\u0442\u0438\u0441\u044f',
  reportQuestion: '\u0429\u043e \u043d\u0435 \u0442\u0430\u043a \u0456\u0437 \u0446\u0456\u0454\u044e \u0442\u0435\u043c\u043e\u044e?',
  reasons: {
    inappropriate: '\u041d\u0435 \u043f\u0456\u0434\u0445\u043e\u0434\u0438\u0442\u044c \u0434\u0456\u0442\u044f\u043c',
    personal_data: '\u041e\u0441\u043e\u0431\u0438\u0441\u0442\u0456 \u0434\u0430\u043d\u0456',
    copyright: '\u0421\u043a\u043e\u043f\u0456\u0439\u043e\u0432\u0430\u043d\u043e \u0431\u0435\u0437 \u0434\u043e\u0437\u0432\u043e\u043b\u0443',
    spam: '\u0421\u043f\u0430\u043c',
    other: '\u0429\u043e\u0441\u044c \u0456\u043d\u0448\u0435',
  },
  reportThanks: '\u0414\u044f\u043a\u0443\u0454\u043c\u043e! \u041c\u0438 \u043f\u0435\u0440\u0435\u0432\u0456\u0440\u0438\u043c\u043e.',
  privacy: '\u041f\u043e\u043b\u0456\u0442\u0438\u043a\u0430 \u043a\u043e\u043d\u0444\u0456\u0434\u0435\u043d\u0446\u0456\u0439\u043d\u043e\u0441\u0442\u0456',
  terms: 'Правила користування',
  contact: 'Контакти',
};

const hi: Strings = {
  lang: 'hi',
  sharedWithYou: '\u0915\u093f\u0938\u0940 \u0928\u0947 \u0924\u0941\u092e\u094d\u0939\u093e\u0930\u0947 \u0938\u093e\u0925 \u090f\u0915 \u0935\u093f\u0937\u092f \u0936\u0947\u092f\u0930 \u0915\u093f\u092f\u093e \u0939\u0948!',
  lessons: (n) => `${n} \u092a\u093e\u0920`,
  questions: (n) => `\u0915\u094d\u0935\u093f\u091c\u093c \u0915\u0947 ${n} \u0938\u0935\u093e\u0932`,
  openInApp: 'Studdly \u092e\u0947\u0902 \u0916\u094b\u0932\u0947\u0902',
  openIn: '\u0916\u094b\u0932\u0947\u0902:',
  googlePlay: 'Google Play \u0938\u0947 \u092a\u093e\u090f\u0901',
  appStore: 'App Store \u0938\u0947 \u0921\u093e\u0909\u0928\u0932\u094b\u0921 \u0915\u0930\u0947\u0902',
  getItOn: '\u092a\u093e\u090f\u0901',
  downloadOnThe: '\u0921\u093e\u0909\u0928\u0932\u094b\u0921 \u0915\u0930\u0947\u0902',
  installHint: 'Studdly \u0905\u092d\u0940 \u0924\u0915 \u0928\u0939\u0940\u0902 \u0939\u0948? \u0907\u0902\u0938\u094d\u091f\u0949\u0932 \u0915\u0930\u094b \u0914\u0930 \u0932\u093f\u0902\u0915 \u092b\u093f\u0930 \u0938\u0947 \u0926\u092c\u093e\u0913\u0964',
  learnInStuddly: 'Studdly \u092e\u0947\u0902 \u0938\u0940\u0916\u094b',
  validUntil: (date) => `\u0932\u093f\u0902\u0915 ${date} \u0924\u0915 \u0915\u093e\u092e \u0915\u0930\u0947\u0917\u093e`,
  notFoundTitle: '\u092f\u0939 \u0935\u093f\u0937\u092f \u0928\u0939\u0940\u0902 \u092e\u093f\u0932\u093e',
  notFoundBody: '\u0932\u093f\u0902\u0915 \u091c\u093e\u0901\u091a\u094b \u092f\u093e \u0926\u094b\u0938\u094d\u0924 \u0938\u0947 \u092b\u093f\u0930 \u092d\u0947\u091c\u0928\u0947 \u0915\u094b \u0915\u0939\u094b\u0964',
  goneTitle: '\u092f\u0939 \u0932\u093f\u0902\u0915 \u0905\u092c \u0915\u093e\u092e \u0928\u0939\u0940\u0902 \u0915\u0930\u0924\u093e',
  goneBody: '\u0926\u094b\u0938\u094d\u0924 \u0938\u0947 \u0935\u093f\u0937\u092f \u092b\u093f\u0930 \u0936\u0947\u092f\u0930 \u0915\u0930\u0928\u0947 \u0915\u094b \u0915\u0939\u094b\u0964',
  busyTitle: '\u090f\u0915 \u092e\u093f\u0928\u091f',
  busyBody: '\u092c\u0939\u0941\u0924 \u091c\u093c\u094d\u092f\u093e\u0926\u093e \u0915\u094b\u0936\u093f\u0936\u0947\u0902\u0964 \u090f\u0915 \u092e\u093f\u0928\u091f \u092c\u093e\u0926 \u092b\u093f\u0930 \u0915\u094b\u0936\u093f\u0936 \u0915\u0930\u094b\u0964',
  errorBody: '\u0939\u092e\u093e\u0930\u0940 \u0924\u0930\u092b\u093c \u0915\u0941\u091b \u0917\u0921\u093c\u092c\u0921\u093c \u0939\u094b \u0917\u0908\u0964 \u0925\u094b\u0921\u093c\u0940 \u0926\u0947\u0930 \u092c\u093e\u0926 \u092b\u093f\u0930 \u0915\u094b\u0936\u093f\u0936 \u0915\u0930\u094b\u0964',
  report: '\u0930\u093f\u092a\u094b\u0930\u094d\u091f \u0915\u0930\u0947\u0902',
  reportQuestion: '\u0907\u0938 \u0935\u093f\u0937\u092f \u092e\u0947\u0902 \u0915\u094d\u092f\u093e \u0917\u0932\u0924 \u0939\u0948?',
  reasons: {
    inappropriate: '\u092c\u091a\u094d\u091a\u094b\u0902 \u0915\u0947 \u0932\u093f\u090f \u0920\u0940\u0915 \u0928\u0939\u0940\u0902',
    personal_data: '\u0928\u093f\u091c\u0940 \u091c\u093e\u0928\u0915\u093e\u0930\u0940',
    copyright: '\u092c\u093f\u0928\u093e \u0907\u091c\u093c\u093e\u091c\u093c\u0924 \u0915\u0949\u092a\u0940 \u0915\u093f\u092f\u093e',
    spam: '\u0938\u094d\u092a\u0948\u092e',
    other: '\u0915\u0941\u091b \u0914\u0930',
  },
  reportThanks: '\u0927\u0928\u094d\u092f\u0935\u093e\u0926! \u0939\u092e \u0926\u0947\u0916\u0947\u0902\u0917\u0947\u0964',
  privacy: '\u092a\u094d\u0930\u093e\u0907\u0935\u0947\u0938\u0940 \u0928\u0940\u0924\u093f',
  terms: 'उपयोग की शर्तें',
  contact: 'संपर्क',
};

const id: Strings = {
  lang: 'id',
  sharedWithYou: 'Ada yang membagikan topik untukmu!',
  lessons: (n) => `${n} pelajaran`,
  questions: (n) => `${n} soal kuis`,
  openInApp: 'Buka di Studdly',
  openIn: 'Buka di',
  googlePlay: 'Dapatkan di Google Play',
  appStore: 'Unduh di App Store',
  getItOn: 'Dapatkan di',
  downloadOnThe: 'Unduh di',
  installHint: 'Belum punya Studdly? Pasang dulu, lalu ketuk tautannya lagi.',
  learnInStuddly: 'Pelajari di Studdly',
  validUntil: (date) => `Tautan berlaku sampai ${date}`,
  notFoundTitle: 'Topik ini tidak ketemu',
  notFoundBody: 'Cek tautannya, atau minta temanmu kirim lagi.',
  goneTitle: 'Tautan ini sudah tidak berfungsi',
  goneBody: 'Minta temanmu membagikan topiknya lagi.',
  busyTitle: 'Sebentar ya',
  busyBody: 'Terlalu banyak percobaan. Coba lagi semenit lagi.',
  errorBody: 'Ada yang salah di sisi kami. Coba lagi sebentar lagi.',
  report: 'Laporkan',
  reportQuestion: 'Apa yang salah dengan topik ini?',
  reasons: {
    inappropriate: 'Tidak pantas untuk anak',
    personal_data: 'Data pribadi',
    copyright: 'Disalin tanpa izin',
    spam: 'Spam',
    other: 'Lainnya',
  },
  reportThanks: 'Terima kasih! Kami akan cek.',
  privacy: 'Kebijakan privasi',
  terms: 'Ketentuan penggunaan',
  contact: 'Kontak',
};

const ALL: Record<string, Strings> = { en, pl, es, de, fr, uk, hi, id };

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
