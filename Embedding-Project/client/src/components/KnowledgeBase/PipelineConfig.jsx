import React from 'react';
import { motion } from 'framer-motion';
import { Zap, SlidersHorizontal, Check } from 'lucide-react';
import { useRAGStore } from '../../store/useRAGStore';

export default function PipelineConfig() {
  const pipelineMode = useRAGStore((state) => state.pipelineMode);
  const setPipelineMode = useRAGStore((state) => state.setPipelineMode);

  return (
    <div className="pipeline-config-card">
      <div className="card-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <SlidersHorizontal size={16} className="text-accent" />
          <h3>Pipeline Mode Selection</h3>
        </div>
      </div>

      <div className="mode-selector">
        <button
          className={`mode-btn ${pipelineMode === 'advanced' ? 'active' : ''}`}
          onClick={() => setPipelineMode('advanced')}
        >
          {pipelineMode === 'advanced' && (
            <motion.div className="active-bg-indicator" layoutId="activeMode" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
          )}
          <span className="btn-content">
            <Zap size={14} className="icon-zap" /> 7-Stage Advanced RAG
            {pipelineMode === 'advanced' && <Check size={14} className="check-icon" />}
          </span>
        </button>

        <button
          className={`mode-btn ${pipelineMode === 'standard' ? 'active' : ''}`}
          onClick={() => setPipelineMode('standard')}
        >
          {pipelineMode === 'standard' && (
            <motion.div className="active-bg-indicator" layoutId="activeMode" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
          )}
          <span className="btn-content">
            🔹 Standard Direct RAG
            {pipelineMode === 'standard' && <Check size={14} className="check-icon" />}
          </span>
        </button>
      </div>
    </div>
  );
}
