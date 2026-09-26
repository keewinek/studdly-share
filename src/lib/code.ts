/**
 * Share codes: no vowels (random codes can't spell words) and no look-alikes
 * (0/O, 1/l/I). Links are permanent, so this alphabet must never change.
 */
export const CODE_ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXYZbcdfghjkmnpqrstvwxyz';
export const GENERATED_CODE_LENGTH = 5;

/** Accepts 5 (current) and 6 (reserved for later growth) characters. */
export const CODE_PATTERN = /^[23456789BCDFGHJKLMNPQRSTVWXYZbcdfghjkmnpqrstvwxyz]{5,6}$/;

export function isValidCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

/** Uniform random code via rejection sampling (no modulo bias). */
export function generateCode(length = GENERATED_CODE_LENGTH): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b >= limit) continue;
      out += CODE_ALPHABET[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}
