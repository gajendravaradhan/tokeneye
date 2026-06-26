import type { KeyCapStatus, KeyEntry, ProxyMode } from "./types.ts";

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

const budgetCache = new Map<string, { value: number; expiresAt: number }>();
const BUDGET_CACHE_TTL_MS = 30_000;

export interface FilterResult {
  usable: KeyEntry[];
  statuses: KeyCapStatus[];
  allExhausted: boolean;
}

export function filterKeysWithBudget(
  keys: KeyEntry[],
  getRollingWindowCost: (subscription: string, windowMs: number) => number,
  providerName: string,
): FilterResult {
  const usable: KeyEntry[] = [];
  const statuses: KeyCapStatus[] = [];
  const now = Date.now();

  for (const key of keys) {
    if (!key.caps || key.caps.length === 0) {
      usable.push(key);
      statuses.push({
        label: key.label,
        exhausted: false,
        remainingBudget: Infinity,
        details: [],
      });
      continue;
    }

    const details: KeyCapStatus["details"] = [];
    let keyExhausted = false;
    let minRemaining = Infinity;

    for (const cap of key.caps) {
      const cacheKey = `${providerName}:${key.label}:${cap.window}`;
      let spent: number;
      const cached = budgetCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        spent = cached.value;
      } else {
        spent = getRollingWindowCost(key.label, cap.window);
        budgetCache.set(cacheKey, { value: spent, expiresAt: now + BUDGET_CACHE_TTL_MS });
      }

      const remaining = cap.budget - spent;
      const percentage = spent / cap.budget;
      const threshold = cap.threshold ?? 0.99;
      const exhausted = percentage >= threshold || remaining < 0.50;

      details.push({
        window: cap.window,
        budget: cap.budget,
        spent,
        remaining,
        percentage,
      });

      if (exhausted) {
        keyExhausted = true;
      }

      if (remaining < minRemaining) {
        minRemaining = remaining;
      }
    }

    const boundedRemaining = Math.min(minRemaining, 0.50);

    statuses.push({
      label: key.label,
      exhausted: keyExhausted,
      remainingBudget: boundedRemaining,
      details,
    });

    if (!keyExhausted) {
      usable.push(key);
    }
  }

  return {
    usable,
    statuses,
    allExhausted: usable.length === 0,
  };
}

export function clearBudgetCache(): void {
  budgetCache.clear();
}
