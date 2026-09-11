import React from 'react';
import { motion } from 'framer-motion';
import { SendHorizontal, Sparkles, Loader2 } from 'lucide-react';
import { useRAGStore } from '../../store/useRAGStore';

export default function ChatInput({ scrollToBottom }) {
  const question = useRAGStore((state) => state.question);
  const setQuestion = useRAGStore((state) => state.setQuestion);
  const isLoading = useRAGStore((state) => state.isLoading);
  const sendQuestion = useRAGStore((state) => state.sendQuestion);

  const handleSend = () => {
    sendQuestion(scrollToBottom);
  };

  return (
    <div className="input-area">
      <div className="input-field-wrapper">
        <Sparkles size={16} className="input-icon-sparkle" />
        <input
          id="questionInput"
          className="question-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask any question about your documents..."
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          autoComplete="off"
        />
      </div>

      <motion.button
        onClick={handleSend}
        disabled={isLoading || !question.trim()}
        className="btn-icon btn-send"
        aria-label="Send Question"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {isLoading ? (
          <Loader2 className="animate-spin" size={18} />
        ) : (
          <SendHorizontal size={18} />
        )}
      </motion.button>
    </div>
  );
}
