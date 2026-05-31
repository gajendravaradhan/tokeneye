import type { KeyEntry, ProxyMode } from "./types.ts";

/**
 * Returns the keys in the order they should be attempted for one request.
 * - `failover`: primary first, then the rest in declared order.
 * - `balance`: round-robin lead by `cursor`; remaining keys follow as failover targets.
 */
export function orderKeys(
  keys: KeyEntry[],
  primary: string,
  mode: ProxyMode,
  cursor: number,
): KeyEntry[] {
  if (keys.length <= 1) return [...keys];
  if (mode === "balance") {
    const lead = ((cursor % keys.length) + keys.length) % keys.length;
    return [...keys.slice(lead), ...keys.slice(0, lead)];
  }
  const idx = keys.findIndex((k) => k.label === primary);
  if (idx < 0) return [...keys];
  return [keys[idx]!, ...keys.slice(0, idx), ...keys.slice(idx + 1)];
}

/** Retry the next key only for a failover-eligible status when another key remains. */
export function shouldFailover(
  status: number,
  failoverStatus: Set<number>,
  isLastAttempt: boolean,
): boolean {
  return !isLastAttempt && failoverStatus.has(status);
}
