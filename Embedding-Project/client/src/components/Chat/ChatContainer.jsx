import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Compass } from 'lucide-react';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import { useRAGStore } from '../../store/useRAGStore';

export default function ChatContainer() {
  const messages = useRAGStore((state) => state.messages);
  const isLoading = useRAGStore((state) => state.isLoading);
  const setQuestion = useRAGStore((state) => state.setQuestion);
  const sendQuestion = useRAGStore((state) => state.sendQuestion);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handlePromptChipClick = (promptText) => {
    setQuestion(promptText);
    setTimeout(() => {
      sendQuestion(scrollToBottom);
    }, 50);
  };

  const quickPrompts = [
    'Summarize key insights',
    'Extract main structured tables',
    'What are the executive takeaways?'
  ];

  return (
    <section className="chat-section">
      <h2>Ask the AI</h2>
      <div className="chat-container">
        <div className="messages">
          {messages.map((msg, idx) => (
            <MessageBubble
              key={idx}
              msg={msg}
              idx={idx}
              scrollToBottom={scrollToBottom}
            />
          ))}

          {messages.length <= 1 && !isLoading && (
            <motion.div
              className="quick-prompts-wrapper"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <span className="prompts-title">
                <Compass size={13} /> Try asking:
              </span>
              <div className="prompt-chips">
                {quickPrompts.map((prompt, i) => (
                  <motion.button
                    key={i}
                    className="prompt-chip"
                    onClick={() => handlePromptChipClick(prompt)}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    <Sparkles size={12} className="text-accent" /> {prompt}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {isLoading && (
            <div className="message ai-message loading">
              <div className="message-bubble">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput scrollToBottom={scrollToBottom} />
      </div>
    </section>
  );
}
