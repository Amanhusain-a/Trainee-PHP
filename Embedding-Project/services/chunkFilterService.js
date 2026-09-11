const { estimateTokens, calculateQualityScore } = require('./extractionService');

/**
 * Advanced Chunk Filtering Engine for DB Storage
 * Filters out junk, low-quality OCR, empty/whitespace noise, header/footer repetition,
 * decorative diagram graphics, and low-information chunks BEFORE embedding and saving to MongoDB.
 */

// Patterns matching header/footer noise or standalone page numbers
const HEADER_FOOTER_PATTERNS = [
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
  /^\s*\d+\s*\/\s*\d+\s*$/,
  /^\s*confidential(\s+and\s+proprietary)?\s*$/i,
  /^\s*all\s+rights\s+reserved\.?\s*$/i,
  /^\s*copyright\s+(©|\(c\))?\s*\d{4}.*$/i,
  /^\s*draft\s*$/i,
  /^\s*do\s+not\s+distribute\s*$/i
];

function isHeaderFooterNoise(text) {
  if (!text) return false;
  const trimmed = text.trim();
  return HEADER_FOOTER_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Evaluates whether a chunk of text meets quality and signal standards
 * to be embedded and stored in the database.
 */
function evaluateChunkForStorage(rawText, options = {}) {
  const {
    minLength = 15,
    minWordCount = 3,
    minAlphaRatio = 0.15,
    minQualityScore = 0.20,
    isTable = false,
    isDiagram = false,
    enableHeaderFooterFilter = true,
    enableQualityFilter = true,
    enableMinLengthFilter = true,
    enableAlphaDensityFilter = true
  } = options;

  if (!rawText || typeof rawText !== 'string') {
    return {
      passed: false,
      reason: 'Empty or invalid chunk text',
      filterApplied: 'EMPTY_CHECK',
      cleanedText: '',
      metrics: { length: 0, wordCount: 0, alphaRatio: 0, qualityScore: 0, tokenCount: 0 }
    };
  }

  // Sanitize whitespace and control characters
  const cleanedText = rawText
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  const length = cleanedText.length;
  const words = cleanedText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const tokenCount = estimateTokens(cleanedText);

  const alphaMatches = cleanedText.match(/[a-zA-Z]/g) || [];
  const digitMatches = cleanedText.match(/[0-9]/g) || [];
  const alphaNumCount = alphaMatches.length + digitMatches.length;
  const alphaRatio = length > 0 ? Number((alphaNumCount / length).toFixed(4)) : 0;
  const qualityScore = calculateQualityScore(cleanedText);

  const metrics = {
    length,
    wordCount,
    alphaRatio,
    qualityScore,
    tokenCount
  };

  // Structured tables or diagram element descriptions have custom formatting rules
  if (isTable || isDiagram) {
    if (length < 10) {
      return { passed: false, reason: 'Structured element content too small', filterApplied: 'MIN_LENGTH_FILTER', cleanedText, metrics };
    }
    if (isDiagram) {
      const isDecorativeNoise = /(decorative|logo|border|header logo|footer graphic|icon|blank graphic|uninformative graphic)/i.test(cleanedText);
      if (isDecorativeNoise) {
        return { passed: false, reason: 'Filtered out non-informative decorative graphic/logo noise', filterApplied: 'DIAGRAM_NOISE_FILTER', cleanedText, metrics };
      }
    }
    return { passed: true, reason: 'Structured element passed verification', filterApplied: null, cleanedText, metrics };
  }

  // 1. Minimum Length & Word Count Filter
  if (enableMinLengthFilter && (length < minLength || wordCount < minWordCount)) {
    return {
      passed: false,
      reason: `Chunk text too short (${length} chars, ${wordCount} words; min required is ${minLength} chars, ${minWordCount} words)`,
      filterApplied: 'MIN_LENGTH_FILTER',
      cleanedText,
      metrics
    };  
  }

  // 2. Alphanumeric Density Filter (reject pure symbol lines like "-------", "++++++", "...")
  if (enableAlphaDensityFilter && alphaRatio < minAlphaRatio) {
    return {
      passed: false,
      reason: `Low alphanumeric ratio (${(alphaRatio * 100).toFixed(1)}%; min required is ${(minAlphaRatio * 100).toFixed(1)}%)`,
      filterApplied: 'ALPHANUMERIC_DENSITY_FILTER',
      cleanedText,
      metrics
    };
  }

  // 3. Header / Footer & Page Number Noise Filter
  if (enableHeaderFooterFilter && isHeaderFooterNoise(cleanedText)) {
    return {
      passed: false,
      reason: 'Detected standalone header/footer or page number noise',
      filterApplied: 'HEADER_FOOTER_NOISE_FILTER',
      cleanedText,
      metrics
    };
  }

  // 4. Low Quality / OCR Garbage Filter
  if (enableQualityFilter) {
    const singleCharWords = words.filter(w => {
      const alphaOnly = w.replace(/[^a-zA-Z]/g, '');
      return alphaOnly.length === 1 && !['a', 'i', 'A', 'I', '&', '1'].includes(alphaOnly);
    });
    const singleCharRatio = wordCount > 0 ? singleCharWords.length / wordCount : 0;

    if (qualityScore < minQualityScore || singleCharRatio >= 0.40) {
      return {
        passed: false,
        reason: `Low quality score (${(qualityScore * 100).toFixed(1)}%) or high single-char OCR noise (${(singleCharRatio * 100).toFixed(1)}%)`,
        filterApplied: 'OCR_QUALITY_FILTER',
        cleanedText,
        metrics
      };
    }
  }

  return {
    passed: true,
    reason: 'Chunk passed all validation and noise filters',
    filterApplied: null,
    cleanedText,
    metrics
  };
}

module.exports = {
  evaluateChunkForStorage,
  isHeaderFooterNoise
};
