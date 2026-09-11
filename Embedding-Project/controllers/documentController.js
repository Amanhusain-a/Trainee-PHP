const DocumentChunk = require('../models/DocumentChunk');
const { redisClient } = require('../config/redis');

const getDocuments = async (req, res) => {
  try {
    const chunks = await DocumentChunk.find({}, 'metadata text');
    const docMap = {};
    chunks.forEach(c => {
      const fname = c.metadata?.filename || 'Unknown Document';
      if (!docMap[fname]) {
        docMap[fname] = {
          filename: fname,
          chunksCount: 0,
          ocrUsed: c.metadata?.ocrUsed || false,
          fileType: c.metadata?.fileType || 'DOC',
          imageUrl: c.metadata?.imageUrl || null,
          qualityScore: c.metadata?.quality_score || 0.9,
          qualityStatus: c.metadata?.quality_status || 'HIGH_QUALITY',
          totalChars: 0
        };
      }
      docMap[fname].chunksCount++;
      docMap[fname].totalChars += (c.text || '').length;
      if (c.metadata?.ocrUsed) docMap[fname].ocrUsed = true;
      if (c.metadata?.quality_score) docMap[fname].qualityScore = c.metadata.quality_score;
      if (c.metadata?.quality_status) docMap[fname].qualityStatus = c.metadata.quality_status;
      if (c.metadata?.imageUrl && !docMap[fname].imageUrl) {
        docMap[fname].imageUrl = c.metadata.imageUrl;
      }
    });
    res.json({ documents: Object.values(docMap), totalChunks: chunks.length });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error fetching documents.' });
  }
};

const deleteDocuments = async (req, res) => {
  try {
    await DocumentChunk.deleteMany({});
    try {
      const keys = await redisClient.keys('chat_cache:*');
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } catch (rErr) {
      console.error('Failed clearing Redis cache:', rErr.message);
    }
    res.json({ message: 'All documents and cached context cleared successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error clearing documents.' });
  }
};

module.exports = { getDocuments, deleteDocuments };
