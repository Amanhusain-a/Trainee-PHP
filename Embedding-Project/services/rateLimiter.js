/**
 * Global Rate Limiter & Request Queue for Gemini Free Tier (15 Requests / Minute)
 * Ensures a mandatory minimum delay between API calls and handles 429 retries with jitter.
 */

let lastCallTimestamp = 0;
const MIN_REQUEST_INTERVAL_MS = 4200; // Enforces max ~14 requests per minute

/**
 * Wraps an async Gemini API function (embedContent or generateContent)
 * with a rate-limited queue and exponential backoff retry with jitter.
 */
async function scheduleGeminiCall(apiFn, maxRetries = 8) {
  let delay = 12000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Enforce minimum interval between consecutive API calls
    const now = Date.now();
    const elapsed = now - lastCallTimestamp;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      const waitTime = MIN_REQUEST_INTERVAL_MS - elapsed;
      await new Promise(r => setTimeout(r, waitTime));
    }
    lastCallTimestamp = Date.now();

    try {
      return await apiFn();
    } catch (err) {
      const errMsg = err.message || '';
      const isQuotaErr = errMsg.includes('429') ||
                        errMsg.includes('RESOURCE_EXHAUSTED') ||
                        errMsg.includes('Quota exceeded') ||
                        errMsg.includes('503') ||
                        errMsg.includes('UNAVAILABLE');

      if (!isQuotaErr || attempt === maxRetries) {
        throw err;
      }

      // Add random jitter (1000ms - 3000ms) to avoid thundering herd
      const jitter = Math.floor(Math.random() * 2000) + 1000;
      const totalWait = delay + jitter;

      console.warn(`[Gemini Rate Limiter] Quota/Server busy (Attempt ${attempt}/${maxRetries}). Pausing for ${(totalWait / 1000).toFixed(1)}s before retry...`);
      await new Promise(r => setTimeout(r, totalWait));

      // Increase delay exponentially for subsequent retries (capped at 45s)
      delay = Math.min(delay * 1.5, 45000);
    }
  }
}

module.exports = {
  scheduleGeminiCall,
  MIN_REQUEST_INTERVAL_MS
};
