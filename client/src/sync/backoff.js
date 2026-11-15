// Retry delay: 2s, 4s, 8s ... capped at 60s, with +-20% random jitter.
export const BASE_MS = 2000;
export const CAP_MS = 60000;

export function backoffMs(attempts, random = Math.random) {
  const n = Math.max(1, attempts);
  const base = Math.min(CAP_MS, BASE_MS * 2 ** (n - 1));
  const jittered = base * (0.8 + 0.4 * random());
  return Math.round(Math.min(CAP_MS, jittered));
}
