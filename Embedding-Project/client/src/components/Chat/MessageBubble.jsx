import React, { useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Bot, User, ChevronDown, ChevronUp, Cpu, Database, AlertTriangle } from 'lucide-react';
import PipelineBreakdown from './PipelineBreakdown';
import { useRAGStore } from '../../store/useRAGStore';

function cleanMarkdownContent(raw) {
  if (!raw) return '';
  return raw
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

export default function MessageBubble({ msg, idx, scrollToBottom }) {
  const [copied, setCopied] = useState(false);

  const expandedPipelineIdx = useRAGStore((state) => state.expandedPipelineIdx);
  const togglePipelineInspector = useRAGStore((state) => state.togglePipelineInspector);

  const handleCopy = () => {
    const textToCopy = cleanMarkdownContent(msg.content);
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUser = msg.type === 'user';
  const isError = !isUser && (msg.isError || msg.content.startsWith('Error:') || msg.content.includes('Rate Limit') || msg.content.includes('429'));

  const formattedMarkdown = cleanMarkdownContent(msg.content);

  return (
    <motion.div
      className={`message-wrapper ${msg.type}-wrapper ${isError ? 'error-wrapper' : ''}`}
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="message-header-row">
        <span className={`avatar-icon ${isError ? 'error-avatar' : ''}`}>
          {isUser ? <User size={14} /> : isError ? <AlertTriangle size={14} /> : <Bot size={14} />}
        </span>
        <span className="sender-name">{isUser ? 'You' : 'DocuMind AI'}</span>
        
        {!isUser && !isError && (
          <button
            className="btn-copy"
            onClick={handleCopy}
            title="Copy answer"
            aria-label="Copy answer to clipboard"
          >
            {copied ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
          </button>
        )}
      </div>

      <div className={`message ${msg.type}-message`}>
        <div className={`message-bubble ${isError ? 'error-bubble' : ''}`}>
          {isUser ? (
            <div>{msg.content}</div>
          ) : isError ? (
            <div className="error-content">
              <AlertTriangle size={16} className="error-icon" />
              <span>{msg.content}</span>
            </div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ node, ...props }) => <p style={{ margin: '0.4rem 0', lineHeight: '1.6' }} {...props} />,
                strong: ({ node, ...props }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }} {...props} />,
                ul: ({ node, ...props }) => <ul style={{ paddingLeft: '1.2rem', margin: '0.4rem 0' }} {...props} />,
                ol: ({ node, ...props }) => <ol style={{ paddingLeft: '1.2rem', margin: '0.4rem 0' }} {...props} />,
                li: ({ node, ...props }) => <li style={{ marginBottom: '0.25rem' }} {...props} />,
                code: ({ node, inline, ...props }) => (
                  inline ? (
                    <code className="inline-code" {...props} />
                  ) : (
                    <pre className="code-block"><code {...props} /></pre>
                  )
                )
              }}
            >
              {formattedMarkdown}
            </ReactMarkdown>
          )}
        </div>
      </div>

      {msg.pipeline && (
        <div className="pipeline-inspector-toggle">
          <button
            className="btn-toggle-pipeline"
            onClick={() => togglePipelineInspector(idx, scrollToBottom)}
          >
            <Cpu size={13} />
            {expandedPipelineIdx === idx ? 'Hide 7-Stage RAG Pipeline Breakdown' : 'View 7-Stage RAG Pipeline Breakdown'}
            {expandedPipelineIdx === idx ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {expandedPipelineIdx === idx && (
            <PipelineBreakdown pipeline={msg.pipeline} />
          )}
        </div>
      )}

      {msg.contextChunks > 0 && !msg.pipeline && (
        <div className="context-info">
          <Database size={12} className="inline-icon" /> Based on {msg.contextChunks} document chunks {msg.cached && '(Cached from Redis ⚡)'}
        </div>
      )}
    </motion.div>
  );
}
