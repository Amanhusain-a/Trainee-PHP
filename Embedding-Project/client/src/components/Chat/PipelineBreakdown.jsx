import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Search, Filter, Layers, Database, Cpu, CheckCircle } from 'lucide-react';

export default function PipelineBreakdown({ pipeline }) {
  if (!pipeline) return null;

  const steps = [
    {
      num: 1,
      icon: <Filter size={14} />,
      title: 'Query Cleaning',
      content: <code>{pipeline.queryCleaning?.cleaned || 'N/A'}</code>
    },
    {
      num: 2,
      icon: <Sparkles size={14} />,
      title: 'Query Rewriting',
      content: <code>{pipeline.queryRewriting?.rewritten || 'N/A'}</code>
    },
    {
      num: 3,
      icon: <Search size={14} />,
      title: 'Query Expansion',
      content: (
        <div className="pill-list">
          {(pipeline.queryExpansion?.expandedQueries || []).map((q, i) => (
            <span key={i} className="pill">{q}</span>
          ))}
        </div>
      )
    },
    {
      num: 4,
      icon: <Layers size={14} />,
      title: 'Query Decomposition',
      content: (
        <div className="pill-list">
          {(pipeline.queryDecomposition?.subQueries || []).map((q, i) => (
            <span key={i} className="pill sub-pill">{q}</span>
          ))}
        </div>
      )
    },
    {
      num: 5,
      icon: <CheckCircle size={14} />,
      title: 'Multi-Query Retrieval',
      content: (
        <p>Evaluated <strong>{pipeline.multiQueryRetrieval?.uniqueQueriesCount || 0}</strong> unique query variations using Reciprocal Rank Fusion (RRF).</p>
      )
    },
    {
      num: 6,
      icon: <Database size={14} />,
      title: 'Vector Search & Similarity Matching',
      content: (
        <>
          <p>Searched <strong>{pipeline.vectorSearch?.totalChunksInDB || 0}</strong> document chunks. Retrieved top {pipeline.vectorSearch?.retrievedCount || 0} matches.</p>
          <div className="chunk-matches">
            {(pipeline.vectorSearch?.topMatches || []).map((m, i) => (
              <div key={i} className="chunk-match-item">
                <div className="match-header">
                  <span className="match-score">Similarity: {(m.score * 100).toFixed(1)}%</span>
                  <div className="similarity-bar-bg">
                    <div className="similarity-bar-fill" style={{ width: `${Math.min(m.score * 100, 100)}%` }}></div>
                  </div>
                </div>
                <p className="chunk-snippet">"{m.snippet}"</p>
              </div>
            ))}
          </div>
        </>
      )
    },
    {
      num: 7,
      icon: <Cpu size={14} />,
      title: 'LLM Context Synthesis & Answer Generation',
      content: (
        <p>Synthesized final response using model: <code>{pipeline.llmAnswerGeneration?.model || 'gemini-1.5-flash'}</code></p>
      )
    }
  ];

  return (
    <motion.div
      className="pipeline-breakdown-card"
      initial={{ opacity: 0, height: 0, y: -10 }}
      animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, y: -10 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <div className="card-title-row">
        <Sparkles size={16} className="text-accent" />
        <h4>⚡ 7-Stage Execution Breakdown Inspector</h4>
      </div>

      <div className="steps-container">
        {steps.map((step) => (
          <motion.div
            key={step.num}
            className="pipeline-step"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: step.num * 0.04 }}
          >
            <span className="step-num">{step.num}</span>
            <div className="step-body">
              <div className="step-title-wrapper">
                <span className="step-icon">{step.icon}</span>
                <strong>{step.title}</strong>
              </div>
              {step.content}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
