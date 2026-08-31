/**
 * Exponential backoff com jitter para retry de operações de sync.
 *
 * Fórmula: baseDelay * 2^attempts + random jitter
 *
 * Exemplo com baseDelay=1000ms, jitter=true:
 *   attempt 1: ~1000-2000ms
 *   attempt 2: ~2000-4000ms
 *   attempt 3: ~4000-8000ms
 *   attempt 4: ~8000-16000ms
 *   attempt 5: ~16000-32000ms
 */

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

const DEFAULT_BASE_DELAY = 1000;
const DEFAULT_MAX_DELAY = 5 * 60 * 1000; // 5 minutos

export function computeBackoff(
  attempts: number,
  baseDelay: number = DEFAULT_BASE_DELAY,
  jitter: boolean = true,
  maxDelay: number = DEFAULT_MAX_DELAY
): number {
  const exponential = Math.min(baseDelay * Math.pow(2, Math.max(0, attempts - 1)), maxDelay);
  if (!jitter) return exponential;

  // Jitter: random entre 50% e 100% do valor exponencial
  const min = exponential * 0.5;
  const max = exponential;
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * Versão "full jitter" recomendada pelo AWS:
 * random entre 0 e o valor exponencial.
 */
export function computeFullJitterBackoff(
  attempts: number,
  baseDelay: number = DEFAULT_BASE_DELAY,
  maxDelay: number = DEFAULT_MAX_DELAY
): number {
  const exponential = Math.min(baseDelay * Math.pow(2, Math.max(0, attempts - 1)), maxDelay);
  return Math.floor(Math.random() * exponential);
}
