const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const { initGemini, LLM_MODEL } = require('../config/gemini');
const { recognizeWithPaddleOCR } = require('./paddleOcrService');

const ai = initGemini();

// Quality and Token Helpers
function estimateTokens(text) {
  return Math.ceil((text || '').trim().split(/\s+/).length * 1.3);
}

function calculateQualityScore(text) {
  if (!text || text.length === 0) return 0.0;
  let alphanumericCount = (text.match(/[a-zA-Z0-9]/g) || []).length;
  return Number((alphanumericCount / text.length).toFixed(4));
}

// Normalize text to remove unwanted characters, stray line-padding, and OCR noise
function normalizeText(text) {
  if (!text) return '';
  
  // 1. Strip zero-width & non-printable control characters
  let cleaned = text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  // 2. Remove TOC dots & repeated border lines (e.g. ". . . .", "----", "====")
  cleaned = cleaned
    .replace(/(?:\.\s*){3,}/g, ' ')
    .replace(/(?:[-_=\|]\s*){3,}/g, ' ');

  // 3. Process line-by-line: trim inline whitespace & strip noise-only lines
  const cleanedLines = cleaned
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(line => {
      if (!line) return false;
      // Filter out lines containing zero alphanumeric characters (pure symbols/junk)
      const alphaNumCount = (line.match(/[a-zA-Z0-9]/g) || []).length;
      if (line.length > 0 && alphaNumCount === 0) return false;
      return true;
    });

  // 4. Rejoin with clean linebreaks and collapse excessive newlines
  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Utility to split text into chunks (Default: 2000 chars for optimal chunk count)
function splitTextIntoChunks(text, chunkSize = 2000, overlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

/**
 * Optical Character Recognition (OCR) Engine
 * Primary Engine: PaddleOCR v4 / Multimodal Vision Layout OCR
 */
async function extractTextWithOCR(buffer, mimetype, filename) {
  try {
    console.log(`[OCR] Executing PaddleOCR Document Text Recognition for ${filename}...`);
    return await recognizeWithPaddleOCR(buffer, mimetype, filename);
  } catch (paddleErr) {
    console.error(`[OCR] PaddleOCR engine error:`, paddleErr);
    throw new Error(`PaddleOCR extraction failed for ${filename}: ${paddleErr.message}`);
  }
}

/**
 * PDF Text Extraction Engine with Scanned Image OCR Fallback
 */
async function extractTextFromPdf(buffer, filename) {
  let text = '';
  let ocrUsed = false;
  try {
    const data = await pdfParse(buffer);
    text = (data.text || '').trim();
  } catch (pdfErr) {
    console.warn(`[PDF] Standard PDF parse failed for ${filename}: ${pdfErr.message}. Retrying via OCR...`);
  }

  // If text is empty or very short (< 15 chars), it's likely a scanned PDF image!
  if (!text || text.length < 15) {
    console.log(`[PDF OCR] PDF has little/no selectable text (${text.length} chars). Invoking OCR on PDF file...`);
    text = await extractTextWithOCR(buffer, 'application/pdf', filename);
    ocrUsed = true;
  }

  return { text, ocrUsed };
}

/**
 * Word Document (DOCX) Extraction Engine
 */
async function extractTextFromDocx(buffer, filename) {
  try {
    console.log(`[DOCX] Parsing Word Document: ${filename}...`);
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (err) {
    console.warn(`[DOCX] Failed to parse ${filename}: ${err.message}`);
    return '';
  }
}

/**
 * Excel (XLS/XLSX) Extraction Engine
 * Formats sheets cleanly as CSV tables so row/col structure is maintained for LLMs
 */
async function extractTextFromExcel(buffer, filename) {
  try {
    console.log(`[EXCEL] Parsing Spreadsheet: ${filename}...`);
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    let fullText = '';
    
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const csvData = xlsx.utils.sheet_to_csv(sheet);
      if (csvData.trim()) {
        fullText += `\n=== Sheet: ${sheetName} ===\n${csvData}\n`;
      }
    });
    
    return fullText.trim();
  } catch (err) {
    console.warn(`[EXCEL] Failed to parse ${filename}: ${err.message}`);
    return '';
  }
}

/**
 * Advanced Document & OCR Quality Assessment Engine
 * Instantly evaluates whether extracted text is readable human language vs unreadable OCR garbage.
 */
function assessDocumentQuality(text) {
  if (!text || text.trim().length === 0) {
    return {
      score: 0.0,
      status: 'EMPTY',
      isUnreadable: true,
      reason: 'No readable text content was found in the document.'
    };
  }

  const cleanText = text.trim();
  const charLength = cleanText.length;
  const alphaMatches = cleanText.match(/[a-zA-Z]/g) || [];
  const digitMatches = cleanText.match(/[0-9]/g) || [];
  const words = cleanText.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0 || alphaMatches.length < 5) {
    return {
      score: 0.0,
      status: 'UNREADABLE_OCR_GARBAGE',
      isUnreadable: true,
      reason: 'Extracted content lacks readable letters/words.'
    };
  }

  // 1. Alphanumeric Ratio
  const alphaNumRatio = (alphaMatches.length + digitMatches.length) / charLength;

  // 2. Fragment & Single-Char Ratio (OCR noise produces many isolated 1-char tokens like "x", "s", "0", "|")
  const singleCharWords = words.filter(w => w.length === 1 && !['a', 'i', 'A', 'I', '&', '1'].includes(w));
  const singleCharRatio = singleCharWords.length / words.length;

  // 3. Average Word Length (Readable text avg is 4.5-6.5; OCR noise is < 2.2 or > 20)
  const totalWordChars = words.reduce((acc, w) => acc + w.length, 0);
  const avgWordLength = totalWordChars / words.length;

  // 4. Common English word hit check
  const commonWords = new Set(['the', 'be', 'to', 'of', 'and', 'in', 'that', 'have', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'data', 'file', 'report', 'invoice', 'table', 'total', 'document', 'date', 'name', 'page', 'number', 'system', 'value', 'price', 'code']);

  let validWordHits = 0;
  words.forEach(w => {
    const cleanW = w.toLowerCase().replace(/[^a-z]/g, '');
    if (commonWords.has(cleanW) || (cleanW.length >= 4 && /^[a-z]+$/.test(cleanW))) {
      validWordHits++;
    }
  });

  const validWordRatio = validWordHits / words.length;

  // Composite Quality Score (0.0 to 1.0)
  let qualityScore = (alphaNumRatio * 0.3) + (validWordRatio * 0.4) + ((1 - Math.min(1, singleCharRatio * 2)) * 0.3);

  if (avgWordLength < 2.2 || avgWordLength > 18) {
    qualityScore *= 0.6;
  }

  qualityScore = Number(Math.max(0, Math.min(1, qualityScore)).toFixed(4));

  let status = 'HIGH_QUALITY';
  let isUnreadable = false;
  let reason = 'Document text is clean and highly readable.';

  if (qualityScore < 0.30 || validWordRatio < 0.15 || singleCharRatio > 0.40) {
    status = 'UNREADABLE_OCR_GARBAGE';
    isUnreadable = true;
    reason = '⚠️ Unreadable OCR text detected! (Blurry scan, severe distortion, or nonsensical character fragments).';
  } else if (qualityScore < 0.55) {
    status = 'LOW_QUALITY';
    reason = 'Low readability text detected. OCR output may contain minor formatting noise.';
  }

  return {
    score: qualityScore,
    status,
    isUnreadable,
    reason,
    stats: {
      totalWords: words.length,
      avgWordLength: Number(avgWordLength.toFixed(1)),
      validWordRatio: Number((validWordRatio * 100).toFixed(1)),
      singleCharRatio: Number((singleCharRatio * 100).toFixed(1))
    }
  };
}

module.exports = {
  estimateTokens,
  calculateQualityScore,
  assessDocumentQuality,
  normalizeText,
  splitTextIntoChunks,
  extractTextWithOCR,
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromExcel
};
