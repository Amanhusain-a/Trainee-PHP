const { initGemini, EMBEDDING_MODEL } = require('../config/gemini');
const { scheduleGeminiCall } = require('./rateLimiter');

const ai = initGemini();

// In-memory query embedding cache (caches up to 300 recent queries to save API quota)
const embeddingCache = new Map();
const MAX_CACHE_SIZE = 300;

/**
 * Robust embedding generator with Rate Limiting & Memory Caching to prevent 429 errors.
 */
async function embedWithRetry(chunkText) {
  if (!chunkText || typeof chunkText !== 'string') {
    throw new Error('Invalid text passed to embedWithRetry');
  }

  const normalizedKey = chunkText.trim().toLowerCase();

  // Check cache hit
  if (embeddingCache.has(normalizedKey)) {
    return embeddingCache.get(normalizedKey);
  }

  // Schedule call through Rate Limiter
  const values = await scheduleGeminiCall(async () => {
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: chunkText
    });
    return response.embeddings[0].values;
  });

  // Store in cache
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const firstKey = embeddingCache.keys().next().value;
    embeddingCache.delete(firstKey);
  }
  embeddingCache.set(normalizedKey, values);

  return values;
}

module.exports = { embedWithRetry };
