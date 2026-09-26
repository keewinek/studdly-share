import { SELF, env } from 'cloudflare:test';
import type { Env } from '../src/env';

export const testEnv = env as unknown as Env;
export const BASE = 'https://share.studdly.app';

let ipCounter = 0;
/** A fresh client IP per call keeps tests independent of rate limits. */
export const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    title: 'Fotosynteza',
    language: 'pl',
    advancement_level: 'normal',
    sub_topics: [
      {
        title: 'Czym jest fotosynteza?',
        content: 'Rośliny zamieniają światło w energię.\n\nTo się dzieje w liściach.',
        questions: [
          { question: 'Gdzie zachodzi fotosynteza?', right_answer: 'W liściach', wrong_answers: ['W korzeniach', 'W kwiatach', 'W glebie'] },
        ],
      },
      {
        title: 'Chlorofil',
        content: 'Chlorofil jest zielony.',
        questions: [
          { question: 'Jaki kolor ma chlorofil?', right_answer: 'Zielony', wrong_answers: ['Czerwony', 'Niebieski'] },
          { question: 'Co pochłania chlorofil?', right_answer: 'Światło', wrong_answers: ['Wodę', 'Glebę', 'Dźwięk'] },
        ],
      },
    ],
    ...overrides,
  };
}

export function createShare(payload: unknown, secret = newSecret(), ip = freshIp()) {
  return SELF.fetch(`${BASE}/api/v1/shares`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'CF-Connecting-IP': ip,
      'X-Studdly-App-Version': '1.3.0+70',
    },
    body: JSON.stringify(payload),
  });
}

export function get(path: string, init: RequestInit = {}) {
  return SELF.fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'CF-Connecting-IP': freshIp(), ...(init.headers as Record<string, string> | undefined) },
    redirect: 'manual',
  });
}
