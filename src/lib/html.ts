export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('pl-PL');
}

/** UTC timestamp, e.g. 2026-09-26 10:15. */
export function formatTime(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(5, 10);
}
