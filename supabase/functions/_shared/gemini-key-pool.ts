/**
 * gemini-key-pool.ts — Round-robin Gemini API key rotation
 *
 * Loads up to 5 API keys from environment and rotates through them
 * to distribute rate limits across keys.
 *
 * Secrets:
 *   GOOGLE_AI_API_KEY   (primary)
 *   GOOGLE_AI_API_KEY_2 .. GOOGLE_AI_API_KEY_5 (pool)
 */

const _pool: string[] = [];
let _loaded = false;
let _idx = 0;

function _load(): void {
  if (_loaded) return;
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) _pool.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) _pool.push(k);
  }
  _loaded = true;
}

/** Returns the next API key in the round-robin pool */
export function getGeminiKey(): string {
  _load();
  if (_pool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  const key = _pool[_idx % _pool.length];
  _idx++;
  return key;
}

/** Check if at least one key is available */
export function hasGeminiKey(): boolean {
  _load();
  return _pool.length > 0;
}

/** Number of keys in the pool */
export function geminiKeyCount(): number {
  _load();
  return _pool.length;
}
