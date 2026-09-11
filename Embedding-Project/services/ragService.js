const { initGemini, LLM_MODEL } = require('../config/gemini');
const { embedWithRetry } = require('./embeddingService');
const { scheduleGeminiCall } = require('./rateLimiter');

const ai = initGemini();

/**
 * Resilient Gemini Content Generation using Rate Limiting Queue & Retries
 * Handles 503 (High Demand) and 429 (Rate Limit) transparently.
 */
async function callGeminiContentWithRetry(prompt) {
  return await scheduleGeminiCall(async () => {
    return await ai.models.generateContent({
      model: LLM_MODEL,
      contents: prompt
    });
  });
}

// Step 1: Query Cleaning
function cleanQuery(query) {
  if (!query) return '';
  return query
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\w\s\?\.\,\-\'\"]/gi, '')
    .replace(/\s+/g, ' ');
}

// Unified Pre-Processing: Combines Stage 2 (Rewriting), Stage 3 (Expansion), Stage 4 (Decomposition) into 1 LLM Call
async function optimizeAndProcessQuery(cleanedQuery) {
  try {
    const prompt = `You are an advanced search query optimization engine for a RAG system.
Given the user's search query, perform three actions:
1. "rewritten": Rewrite it to be clear, explicit, concise, and optimized for vector retrieval.
2. "expanded": Generate 2 alternative phrasing variants or domain synonyms.
3. "decomposed": Break down complex compound questions into up to 3 atomic sub-questions (or return just the query if simple).

Return ONLY valid JSON matching this schema:
{
  "rewritten": "string",
  "expanded": ["string", "string"],
  "decomposed": ["string"]
}

User Query: "${cleanedQuery}"`;

    const response = await callGeminiContentWithRetry(prompt);
    const rawText = (response.text || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(rawText);

    return {
      rewritten: parsed.rewritten || cleanedQuery,
      expanded: Array.isArray(parsed.expanded) && parsed.expanded.length > 0 ? parsed.expanded : [cleanedQuery],
      decomposed: Array.isArray(parsed.decomposed) && parsed.decomposed.length > 0 ? parsed.decomposed : [cleanedQuery]
    };
  } catch (err) {
    console.error('Query Optimization Error:', err.message);
    return {
      rewritten: cleanedQuery,
      expanded: [cleanedQuery],
      decomposed: [cleanedQuery]
    };
  }
}

// Step 6: Vector Similarity Search for a single query
async function performVectorSearch(queryStr, allChunks) {
  const queryEmbedding = await embedWithRetry(queryStr);

  const cosineSimilarity = (vecA, vecB) => {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  return allChunks.map(chunk => ({
    id: chunk._id.toString(),
    text: chunk.text,
    metadata: chunk.metadata,
    score: cosineSimilarity(queryEmbedding, chunk.embedding)
  }));
}

// Step 5: Multi-Query Retrieval with Reciprocal Rank Fusion (THROTTLED & RESILIENT)
async function multiQueryRetrieval(queryList, allChunks) {
  const rrfMap = new Map();
  const kConst = 60;

  // Process top 2 unique subqueries with rate limiting
  const searchResults = [];
  const cappedQueries = Array.from(new Set(queryList)).slice(0, 2);

  for (let idx = 0; idx < cappedQueries.length; idx++) {
    const q = cappedQueries[idx];
    try {
      const scored = await performVectorSearch(q, allChunks);
      searchResults.push({ query: q, scored });
    } catch (searchErr) {
      console.warn(`[MultiQuery Warning] Retrieval skipped for subquery "${q}": ${searchErr.message}`);
    }
  }

  for (const { query: q, scored } of searchResults) {
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, 5);

    topK.forEach((item, rank) => {
      const rrfScore = 1 / (kConst + (rank + 1));
      if (rrfMap.has(item.id)) {
        const existing = rrfMap.get(item.id);
        existing.rrfScore += rrfScore;
        existing.maxVectorScore = Math.max(existing.maxVectorScore, item.score);
        if (!existing.matchedQueries.includes(q)) {
          existing.matchedQueries.push(q);
        }
      } else {
        rrfMap.set(item.id, {
          id: item.id,
          text: item.text,
          metadata: item.metadata,
          rrfScore,
          maxVectorScore: item.score,
          matchedQueries: [q]
        });
      }
    });
  }

  const aggregated = Array.from(rrfMap.values());
  aggregated.sort((a, b) => b.rrfScore - a.rrfScore);
  return aggregated.slice(0, 5);
}

const { performNumericalTableAnalysis } = require('./tableExtractionService');

// Step 7: LLM Answer Generation with Multimodal Layout Support & Resilient Retries
async function generateLLMAnswer(question, topChunks, subQueries) {
  const contextBlocks = topChunks.map((c, i) => {
    const elemType = (c.metadata?.element_type || c.metadata?.chunk_type || 'text').toUpperCase();
    let blockText = `--- [Chunk ${i + 1} | Type: ${elemType} | File: ${c.metadata?.filename || 'Document'} | Similarity: ${((c.maxVectorScore || c.score || 0) * 100).toFixed(1)}%] ---\n${c.text}`;

    if (elemType === 'TABLE' && c.metadata?.table_data) {
      const tblData = c.metadata.table_data;
      const analytics = performNumericalTableAnalysis(question, tblData);
      
      let tableJsonStr = JSON.stringify(tblData, null, 2);
      let analyticsStr = '';

      if (analytics && analytics.numericAnalytics && analytics.numericAnalytics.length > 0) {
        analyticsStr = `\n\n[DETERMINISTIC TABLE NUMERICAL CALCULATIONS]:\n` +
          analytics.numericAnalytics.map(a => 
            `* Column "${a.column}": Sum = ${a.sum}, Count = ${a.count}, Average = ${a.average}, Max = ${a.max}, Min = ${a.min}`
          ).join('\n');
      }

      blockText += `\n\n[Structured Table Source JSON]:\n${tableJsonStr}${analyticsStr}`;
    } else if ((elemType === 'DIAGRAM' || elemType === 'CHART' || elemType === 'IMAGE') && (c.metadata?.diagram_description || c.text)) {
      const pageInfo = c.metadata?.page ? ` | Page ${c.metadata.page}` : '';
      const diagTitle = c.metadata?.diagram_title ? `Title: ${c.metadata.diagram_title}\n` : '';
      const diagCategory = c.metadata?.diagram_category ? `Category: ${c.metadata.diagram_category}\n` : '';
      blockText += `\n\n[Visual Diagram & Flowchart Multimodal Analysis${pageInfo}]:\n${diagTitle}${diagCategory}${c.metadata?.diagram_description || c.text}`;
    }

    return blockText;
  });

  const context = contextBlocks.join('\n\n');

  const prompt = `You are a highly capable Q&A assistant using an Advanced RAG Pipeline with Multimodal Layout & Structured Diagram Analysis.
Answer the user's question accurately using the provided document, table, and diagram context chunks.

User Question: ${question}
Sub-queries Analyzed: ${subQueries.join('; ')}

Retrieved Document & Diagram Context:
${context}

Instructions:
1. Answer directly and logically based on the provided context.
2. For numerical questions (Total, Sum, Count, Average, Max, Min, Price), refer directly to the structured table records and [DETERMINISTIC TABLE NUMERICAL CALCULATIONS] provided. Do not guess values.
3. For visual diagrams, flowcharts, schematics, or architecture diagrams (refer to [Visual Diagram & Flowchart Multimodal Analysis]), explain the visual workflow and components step-by-step using clear visual flow indicators (e.g., Step 1 ➔ Step 2 ➔ Step 3) and cite the document & page number.
4. Use clean markdown formatting (bold headers, bullet lists, currency symbols) for clarity.
5. If the context does not contain enough information, state clearly what details are available and what is missing.

Answer:`;

  const chatResponse = await callGeminiContentWithRetry(prompt);
  return chatResponse.text;
}

module.exports = {
  cleanQuery,
  optimizeAndProcessQuery,
  multiQueryRetrieval,
  generateLLMAnswer,
  callGeminiContentWithRetry
};
