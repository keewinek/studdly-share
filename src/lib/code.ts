/**
 * Share codes: no vowels (random codes can't spell words) and no look-alikes
 * (0/O, 1/l/I). Links are permanent, so this alphabet must never change.
 */
export const CODE_ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXYZbcdfghjkmnpqrstvwxyz';
export const GENERATED_CODE_LENGTH = 8;

/** Accepts 5–8 characters: 8 is generated today, 5 (legacy links are permanent) and 6–7 stay valid. */
export const CODE_PATTERN = /^[23456789BCDFGHJKLMNPQRSTVWXYZbcdfghjkmnpqrstvwxyz]{5,8}$/;

/**
 * First path segments that are never share codes. None of them can match
 * CODE_PATTERN anyway (they contain vowels or dots), and tests assert that
 * stays true — but the landing route also checks this list explicitly.
 */
export const RESERVED_PATHS = ['admin', 'api', '.well-known', 'robots.txt', 'favicon.ico', 'icon.png', 'logotype.png', 'sloth.png', 'styles.css', 'admin.css', 'admin.js', 'report.js', 'fonts'] as const;

export function isValidCode(value: string): boolean {
  return CODE_PATTERN.test(value) && !(RESERVED_PATHS as readonly string[]).includes(value);
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
