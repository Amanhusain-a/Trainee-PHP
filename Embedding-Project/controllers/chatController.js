const DocumentChunk = require('../models/DocumentChunk');
const { redisClient } = require('../config/redis');
const { cleanQuery, optimizeAndProcessQuery, multiQueryRetrieval, generateLLMAnswer } = require('../services/ragService');

function formatErrorMessage(err) {
  let raw = typeof err === 'string' ? err : (err?.message || 'An error occurred while generating the response.');

  if (raw.trim().startsWith('{') && raw.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.error && parsed.error.message) {
        raw = parsed.error.message;
      }
    } catch (e) {
      // Ignore JSON parse fail
    }
  }

  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return 'Gemini AI service is currently experiencing temporary high demand (503). Automatic retries were performed. Please wait a few seconds and try sending your question again.';
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('Quota exceeded')) {
    return 'Gemini API Rate Limit reached (429). Please wait 10-15 seconds before trying again.';
  }

  return raw;
}

const handleChat = async (req, res) => {
  try {
    const { question, mode = 'advanced' } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    // Step 0: Check Redis Cache (Instant ~5ms response)
    const cacheKey = `chat_cache:${question.toLowerCase().trim()}:${mode}`;
    try {
      const cachedResponse = await redisClient.get(cacheKey);
      if (cachedResponse) {
        console.log('Cache hit for question:', question);
        const parsed = JSON.parse(cachedResponse);
        return res.json({ ...parsed, cached: true });
      }
    } catch (cacheErr) {
      console.error('Redis cache error:', cacheErr.message);
    }

    const allChunks = await DocumentChunk.find({});
    if (allChunks.length === 0) {
      return res.status(400).json({ error: 'No documents uploaded yet. Please upload a PDF or TXT file first.' });
    }

    // STAGE 1: Query Cleaning
    const cleanedQuery = cleanQuery(question);

    let rewrittenQuery = cleanedQuery;
    let expandedQueries = [cleanedQuery];
    let subQueries = [cleanedQuery];

    if (mode === 'advanced') {
      // STAGES 2, 3, 4: Unified LLM Pre-Processing Call
      const optResult = await optimizeAndProcessQuery(cleanedQuery);
      rewrittenQuery = optResult.rewritten;
      expandedQueries = optResult.expanded;
      subQueries = optResult.decomposed;
    }

    // Aggregate unique query variations for STAGE 5 & 6
    const querySet = new Set([cleanedQuery, rewrittenQuery, ...expandedQueries, ...subQueries]);
    const uniqueQueries = Array.from(querySet);

    // STAGE 5 & 6: Parallel Vector Search & Multi-Query Retrieval
    const topChunks = await multiQueryRetrieval(uniqueQueries, allChunks);

    // STAGE 7: LLM Answer Generation
    const answer = await generateLLMAnswer(question, topChunks, subQueries);

    const pipelineData = {
      queryCleaning: { raw: question, cleaned: cleanedQuery },
      queryRewriting: { rewritten: rewrittenQuery },
      queryExpansion: { expandedQueries },
      queryDecomposition: { subQueries },
      multiQueryRetrieval: { uniqueQueriesCount: uniqueQueries.length, uniqueQueries },
      vectorSearch: {
        totalChunksInDB: allChunks.length,
        retrievedCount: topChunks.length,
        topMatches: topChunks.map(c => ({
          filename: c.metadata?.filename,
          score: Math.round(c.maxVectorScore * 1000) / 1000,
          snippet: c.text.substring(0, 150) + '...'
        }))
      },
      llmAnswerGeneration: {
        model: 'gemini-3.6-flash'
      }
    };

    const responsePayload = {
      answer,
      contextChunks: topChunks.length,
      pipeline: mode === 'advanced' ? pipelineData : null
    };

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(responsePayload));
    } catch (cacheErr) {
      console.error('Failed to cache response:', cacheErr.message);
    }

    res.json(responsePayload);
  } catch (error) {
    console.error('Error generating chat response:', error);
    const formattedError = formatErrorMessage(error);
    res.status(500).json({ error: formattedError });
  }
};

module.exports = { handleChat };
