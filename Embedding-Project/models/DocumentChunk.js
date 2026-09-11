const mongoose = require('mongoose');

const documentChunkSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
  },
  embedding: {
    type: [Number],
    required: true,
  },
  fileHash: {
    type: String,
    index: true,
  },
  chunkHash: {
    type: String,
    index: true,
  },
  metadata: {
    chunk_type: { type: String, default: 'text' },
    token_count: { type: Number, default: 0 },
    page: { type: Number, default: 1 },
    num_pages: { type: Number, default: 1 },
    parser_version: { type: String, default: 'pdf-parse-v1.1' },
    content_source: { type: String, default: 'native' },
    ocr_applied: { type: Boolean, default: false },
    ocr_confidence: { type: Number, default: null },
    quality_score: { type: Number, default: 1.0 },
    ocr_provider: { type: String, default: null },
    preprocessing_profile: { type: String, default: null },
    ocr_attempt: { type: Number, default: 0 },
    language: { type: String, default: 'eng' },
    language_confidence: { type: Number, default: 1.0 },
    element_type: { type: String, default: 'text' },
    table_id: String,
    sheet: String,
    table_data: { type: mongoose.Schema.Types.Mixed, default: null },
    search_text: String,
    filename: String,
    savedFilename: String,
    imageUrl: String,
    chunkIndex: Number,
    fileType: String,
    ocrUsed: Boolean,
    filter_status: { type: String, default: 'PASSED' },
    filter_applied: { type: String, default: null },
    filter_metrics: {
      alpha_ratio: { type: Number, default: 1.0 },
      quality_score: { type: Number, default: 1.0 },
      word_count: { type: Number, default: 0 },
      token_count: { type: Number, default: 0 }
    }
  }
}, { timestamps: true, strict: false });

// Create a model
const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);

module.exports = DocumentChunk;
