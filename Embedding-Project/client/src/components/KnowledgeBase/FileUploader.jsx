import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, FileText, FileSpreadsheet, FileImage, Loader2, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useRAGStore } from '../../store/useRAGStore';

export default function FileUploader() {
  const fileInputRef = useRef(null);

  const isDragOver = useRAGStore((state) => state.isDragOver);
  const setIsDragOver = useRAGStore((state) => state.setIsDragOver);
  const isUploading = useRAGStore((state) => state.isUploading);
  const uploadStatus = useRAGStore((state) => state.uploadStatus);
  const handleFile = useRAGStore((state) => state.handleFile);

  const triggerConfetti = () => {
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  const onFileChange = (file) => {
    handleFile(file);
    triggerConfetti();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isUploading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileChange(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  return (
    <motion.div
      className={`upload-box ${isDragOver ? 'dragover' : ''} ${isUploading ? 'uploading' : ''}`}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onDragOver={(e) => { e.preventDefault(); if (!isUploading) setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        accept=".txt, .pdf, .md, .csv, .png, .jpg, .jpeg, .webp, .bmp, .tiff, .docx, .xls, .xlsx"
        hidden
        disabled={isUploading}
        onChange={(e) => e.target.files.length && onFileChange(e.target.files[0])}
      />
      
      <div className="upload-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', width: '100%' }}>
        <motion.div
          className="upload-icon-wrapper"
          animate={isUploading ? { rotate: 360 } : {}}
          transition={isUploading ? { repeat: Infinity, duration: 1.5, ease: 'linear' } : {}}
        >
          {isUploading ? (
            <Loader2 className="upload-icon spinning" size={38} />
          ) : (
            <UploadCloud className="upload-icon" size={40} />
          )}
        </motion.div>

        <div className="upload-text-group">
          <p className="upload-title">Drag & drop files or click to browse</p>
          <p className="upload-subtitle">Supported: PDF, Word (.docx), Excel (.xlsx), TXT & Images (OCR)</p>
        </div>

        <div className="file-type-pills">
          <span className="type-pill"><FileText size={12} /> PDF & Word</span>
          <span className="type-pill"><FileSpreadsheet size={12} /> Excel CSV</span>
          <span className="type-pill"><FileImage size={12} /> OCR Scans</span>
        </div>

        <motion.button
          className="btn-upload"
          onClick={() => !isUploading && fileInputRef.current?.click()}
          disabled={isUploading}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          {isUploading ? (
            <>
              <Loader2 className="animate-spin" size={16} /> Extracting Content...
            </>
          ) : (
            <>
              <Sparkles size={16} /> Browse Documents
            </>
          )}
        </motion.button>
      </div>

      <AnimatePresence>
        {uploadStatus && (
          <motion.div
            className="upload-status"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            dangerouslySetInnerHTML={{ __html: uploadStatus }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
