import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, FileText, Trash2, Layers, FileCode, FileSpreadsheet, Image } from 'lucide-react';
import { useRAGStore } from '../../store/useRAGStore';

export default function DocumentList() {
  return null;

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'].includes(ext)) {
      return <Image size={14} className="file-type-icon text-purple" />;
    }
    if (['xls', 'xlsx', 'csv'].includes(ext)) {
      return <FileSpreadsheet size={14} className="file-type-icon text-emerald" />;
    }
    if (['json', 'md'].includes(ext)) {
      return <FileCode size={14} className="file-type-icon text-cyan" />;
    }
    return <FileText size={14} className="file-type-icon text-indigo" />;
  };

  return (
    <motion.div
      className="doc-list-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="doc-list-header">
        <div className="title-group">
          <Database size={15} className="text-accent" />
          <h4>Indexed Documents ({documents.length})</h4>
        </div>
        <button
          className="btn-clear-docs"
          onClick={clearKnowledgeBase}
          title="Clear all indexed documents"
        >
          <Trash2 size={13} /> Clear Base
        </button>
      </div>

      <div className="doc-items-container">
        <AnimatePresence>
          {documents.map((doc, idx) => (
            <motion.div
              key={idx}
              className="doc-item-row"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: idx * 0.05 }}
            >
              <div className="doc-info">
                {getFileIcon(doc.filename)}
                <span className="doc-name" title={doc.filename}>{doc.filename}</span>
              </div>
              <div className="doc-meta-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="chunk-count-badge">
                  <Layers size={11} /> {doc.chunksCount || 1} chunks
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="doc-list-footer">
        <span className="total-stats">
          ⚡ <strong>{totalChunksCount}</strong> total vector embeddings indexed
        </span>
      </div>
    </motion.div>
  );
}
