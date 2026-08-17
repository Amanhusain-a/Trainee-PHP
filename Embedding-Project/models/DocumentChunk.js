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
  metadata: {
    filename: String,
    chunkIndex: Number,
  }
});

// Create a model
const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);

module.exports = DocumentChunk;
