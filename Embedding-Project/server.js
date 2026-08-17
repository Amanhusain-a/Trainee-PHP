require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs = require('fs');
const { createClient } = require('redis');
const DocumentChunk = require('./models/DocumentChunk');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set up Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const EMBEDDING_MODEL = 'gemini-embedding-001';
const LLM_MODEL = 'gemini-3.6-flash';

// Set up Multer for file uploads (in-memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Connect to Redis
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});
redisClient.on('error', err => console.log('Redis Client Error', err));
redisClient.connect().then(() => console.log('Redis Connected')).catch(console.error);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log('MongoDB connection error. Ensure MONGO_URI is set properly.', err));

// Utility to split text into chunks
function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

// ----------------------------------------------------
// STEP 1 - 5: Upload, Extract, Split, Embed, Store
// ----------------------------------------------------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    let text = '';
    const filename = req.file.originalname;

    // Step 1.5 - Save Raw File Locally
    try {
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const localFilePath = path.join(uploadsDir, `${Date.now()}_${filename}`);
      fs.writeFileSync(localFilePath, req.file.buffer);
      console.log(`Saved ${filename} locally to ${localFilePath}`);
    } catch (saveErr) {
      console.error('Failed to save file locally:', saveErr.message);
    }

    // Step 2: Extract Text
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdfParse(req.file.buffer);
      text = data.text;
    } else if (req.file.mimetype === 'text/plain') {
      text = req.file.buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use PDF or TXT.' });
    }

    if (!text.trim()) {
      return res.status(400).json({ error: 'Extracted text is empty.' });
    }

    // Step 3: Split into chunks
    const chunks = splitTextIntoChunks(text);

    // Step 4 & 5: Generate Embeddings and Store in MongoDB
    let storedCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      if (!chunkText.trim()) continue;

      // Generate embedding
      const response = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: chunkText
      });
      const embedding = response.embeddings[0].values;

      // Store in DB
      await DocumentChunk.create({
        text: chunkText,
        embedding: embedding,
        metadata: {
          filename,
          chunkIndex: i
        }
      });
      storedCount++;
    }

    res.json({ message: `Successfully processed and stored ${storedCount} chunks from ${filename}.` });

  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: error.message || 'Error processing file upload.' });
  }
});

// ----------------------------------------------------
// ADVANCED Q&A PIPELINE STEPS (1 - 7) - PERFORMANCE OPTIMIZED
// ----------------------------------------------------

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

    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: prompt
    });

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
  const queryEmbeddingResponse = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: queryStr
  });
  const queryEmbedding = queryEmbeddingResponse.embeddings[0].values;

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

// Step 5: Multi-Query Retrieval with Reciprocal Rank Fusion (PARALLEL EMBEDDING CALLS)
async function multiQueryRetrieval(queryList, allChunks) {
  const rrfMap = new Map();
  const kConst = 60;

  // Execute all embedding searches in parallel (drastically reduces latency!)
  const searchResults = await Promise.all(
    queryList.map(async (q) => {
      const scored = await performVectorSearch(q, allChunks);
      return { query: q, scored };
    })
  );

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

// Step 7: LLM Answer Generation
async function generateLLMAnswer(question, topChunks, subQueries) {
  const context = topChunks
    .map((c, i) => `--- [Chunk ${i + 1} | File: ${c.metadata?.filename || 'Document'} | Similarity: ${(c.maxVectorScore * 100).toFixed(1)}%] ---\n${c.text}`)
    .join('\n\n');

  const prompt = `You are a highly capable Q&A assistant using an Advanced RAG Pipeline.
Answer the user's question accurately using only the provided context chunks.

User Question: ${question}
Sub-queries Analyzed: ${subQueries.join('; ')}

Retrieved Document Context:
${context}

Instructions:
1. Answer directly and logically based on the context provided.
2. Use markdown formatting (bold text, bullet lists) for clarity.
3. If the context does not contain enough information, state what details are available and what is missing.

Answer:`;

  const chatResponse = await ai.models.generateContent({
    model: LLM_MODEL,
    contents: prompt
  });

  return chatResponse.text;
}

// ----------------------------------------------------
// STEP 6 - 11: Chat Endpoint with Optimized 7-Stage RAG
// ----------------------------------------------------
app.post('/api/chat', async (req, res) => {
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
          rrfScore: Math.round(c.rrfScore * 10000) / 10000,
          matchedQueries: c.matchedQueries,
          snippet: c.text.slice(0, 120) + (c.text.length > 120 ? '...' : '')
        }))
      },
      llmAnswerGeneration: { model: LLM_MODEL, status: 'completed' }
    };

    const responsePayload = {
      answer,
      contextChunks: topChunks.length,
      cached: false,
      pipeline: pipelineData
    };

    // Cache in Redis for 1 hour
    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(responsePayload));
    } catch (cacheErr) {
      console.error('Failed to set cache in Redis:', cacheErr.message);
    }

    res.json(responsePayload);
  } catch (error) {
    console.error('Error processing question:', error);
    res.status(500).json({ error: error.message || 'Error answering question.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
