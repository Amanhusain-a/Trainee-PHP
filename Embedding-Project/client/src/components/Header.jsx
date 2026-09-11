import React from 'react';
import { motion } from 'framer-motion';
import { Cpu, Sparkles, Layers, ShieldCheck } from 'lucide-react';

export default function Header() {
  return (
    <motion.header
      className="app-header"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div className="logo">
        <div className="icon-wrapper">
          <Cpu className="icon" size={32} />
        </div>
        <h1>DocuMind <span className="gradient-text">AI</span></h1>
      </div>
      <p className="subtitle">Enterprise Multimodal RAG & Intelligent OCR Extraction Platform</p>
      
      <div className="status-badges-row">
        <span className="badge-pill active">
          <span className="dot-live"></span> 7-Stage RAG Engine
        </span>
        <span className="badge-pill glow">
          <Sparkles size={13} /> Gemini 1.5 & OCR Native
        </span>
        <span className="badge-pill">
          <ShieldCheck size={13} /> SHA-256 Idempotent
        </span>
      </div>
    </motion.header>
  );
}
