const { GoogleGenAI } = require('@google/genai');

const initGemini = () => {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
};

const EMBEDDING_MODEL = 'gemini-embedding-001';
const LLM_MODEL = 'gemini-3.6-flash';

module.exports = { initGemini, EMBEDDING_MODEL, LLM_MODEL };
