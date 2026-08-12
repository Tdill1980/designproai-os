/**
 * Wraps a promise with a timeout. If the promise doesn't settle within
 * the given duration, the returned promise rejects with a timeout error.
 *
 * This prevents UI spinners from hanging forever when edge-function calls
 * stall (network issues, Gemini API hangs, etc.).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'Operation'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Default timeout for a single additional-view render (180 seconds).
 *  Edge function has 4 Gemini retry tiers - 90s was too short for views
 *  that need multiple attempts (hood_detail, close-up). */
export const VIEW_RENDER_TIMEOUT_MS = 180_000;
