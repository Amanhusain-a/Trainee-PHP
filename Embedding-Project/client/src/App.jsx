import { useState, useRef } from 'react';

function App() {
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      content: 'Hello! Upload a document above, then ask me questions. Advanced RAG Query Optimization is enabled across 7 pipeline stages.'
    }
  ]);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [pipelineMode, setPipelineMode] = useState('advanced');
  const [expandedPipelineIdx, setExpandedPipelineIdx] = useState(null);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleFile = async (file) => {
    if (!file || (file.type !== 'application/pdf' && file.type !== 'text/plain')) {
      setUploadStatus('<span style="color: #ef4444;">Please upload a PDF or TXT file.</span>');
      return;
    }

    setUploadStatus('<span style="color: var(--text-secondary);">Uploading and analyzing document...</span>');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (response.ok) {
        setUploadStatus(`<span style="color: #10b981;">✓ ${data.message}</span>`);
      } else {
        setUploadStatus(`<span style="color: #ef4444;">Error: ${data.error}</span>`);
      }
    } catch (err) {
      setUploadStatus('<span style="color: #ef4444;">Upload failed. Please try again.</span>');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const sendQuestion = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return;

    setMessages(prev => [...prev, { type: 'user', content: trimmedQuestion }]);
    setQuestion('');
    setIsLoading(true);
    setTimeout(scrollToBottom, 100);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question: trimmedQuestion, mode: pipelineMode })
      });
      const data = await response.json();

      setIsLoading(false);

      if (response.ok) {
        const formattedAnswer = data.answer
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        setMessages(prev => [
          ...prev,
          {
            type: 'ai',
            content: formattedAnswer,
            contextChunks: data.contextChunks,
            cached: data.cached,
            pipeline: data.pipeline
          }
        ]);
      } else {
        setMessages(prev => [...prev, { type: 'ai', content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      setIsLoading(false);
      setMessages(prev => [...prev, { type: 'ai', content: 'Sorry, there was an error processing your request.' }]);
    }
    setTimeout(scrollToBottom, 100);
  };

  const togglePipelineInspector = (idx) => {
    setExpandedPipelineIdx(prev => (prev === idx ? null : idx));
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          <h1>DocuMind <span>AI</span></h1>
        </div>
        <p className="subtitle">Advanced RAG & Retrieval Optimization Platform</p>
      </header>

      <main className="main-content">
        <section className="upload-section">
          <h2>Knowledge Base</h2>
          <div 
            className={`upload-box ${isDragOver ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              accept=".txt, .pdf" 
              hidden 
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <div className="upload-content">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="upload-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <p>Drag & drop your PDF or TXT document</p>
              <button className="btn-primary" onClick={() => fileInputRef.current.click()}>Browse Files</button>
            </div>
            <div className="upload-status" dangerouslySetInnerHTML={{ __html: uploadStatus }}></div>
          </div>

          <div className="pipeline-config-card">
            <h3>Pipeline Mode</h3>
            <div className="mode-selector">
              <button 
                className={`mode-btn ${pipelineMode === 'advanced' ? 'active' : ''}`}
                onClick={() => setPipelineMode('advanced')}
              >
                ⚡ 7-Stage Advanced RAG
              </button>
              <button 
                className={`mode-btn ${pipelineMode === 'standard' ? 'active' : ''}`}
                onClick={() => setPipelineMode('standard')}
              >
                🔹 Standard Direct RAG
              </button>
            </div>
          </div>
        </section>

        <section className="chat-section">
          <h2>Ask the AI</h2>
          <div className="chat-container">
            <div className="messages">
              {messages.map((msg, idx) => (
                <div key={idx} className={`message-wrapper ${msg.type}-wrapper`}>
                  <div className={`message ${msg.type}-message`}>
                    <div className="message-bubble" dangerouslySetInnerHTML={{ __html: msg.content }}></div>
                  </div>

                  {msg.pipeline && (
                    <div className="pipeline-inspector-toggle">
                      <button className="btn-toggle-pipeline" onClick={() => togglePipelineInspector(idx)}>
                        {expandedPipelineIdx === idx ? '▼ Hide 7-Stage RAG Pipeline Breakdown' : '▶ View 7-Stage RAG Pipeline Breakdown'}
                      </button>
                      
                      {expandedPipelineIdx === idx && (
                        <div className="pipeline-breakdown-card">
                          <h4>⚡ 7-Stage Execution Breakdown</h4>
                          <div className="pipeline-step">
                            <span className="step-num">1</span>
                            <div className="step-body">
                              <strong>Query Cleaning</strong>
                              <code>{msg.pipeline.queryCleaning.cleaned}</code>
                            </div>
                          </div>

                          <div className="pipeline-step">
                            <span className="step-num">2</span>
                            <div className="step-body">
                              <strong>Query Rewriting</strong>
                              <code>{msg.pipeline.queryRewriting.rewritten}</code>
                            </div>
                          </div>

                          <div className="pipeline-step">
                            <span className="step-num">3</span>
                            <div className="step-body">
                              <strong>Query Expansion</strong>
                              <div className="pill-list">
                                {msg.pipeline.queryExpansion.expandedQueries.map((q, i) => (
                                  <span key={i} className="pill">{q}</span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="pipeline-step">
                            <span className="step-num">4</span>
                            <div className="step-body">
                              <strong>Query Decomposition</strong>
                              <div className="pill-list">
                                {msg.pipeline.queryDecomposition.subQueries.map((q, i) => (
                                  <span key={i} className="pill sub-pill">{q}</span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="pipeline-step">
                            <span className="step-num">5</span>
                            <div className="step-body">
                              <strong>Multi-Query Retrieval</strong>
                              <p>Evaluated {msg.pipeline.multiQueryRetrieval.uniqueQueriesCount} unique query variations with Reciprocal Rank Fusion (RRF).</p>
                            </div>
                          </div>

                          <div className="pipeline-step">
                            <span className="step-num">6</span>
                            <div className="step-body">
                              <strong>Vector Search</strong>
                              <p>Searched {msg.pipeline.vectorSearch.totalChunksInDB} document chunks. Retrived top {msg.pipeline.vectorSearch.retrievedCount} chunks.</p>
                              <div className="chunk-matches">
                                {msg.pipeline.vectorSearch.topMatches.map((m, i) => (
                                  <div key={i} className="chunk-match-item">
                                    <span className="match-score">Similarity: {(m.score * 100).toFixed(1)}%</span>
                                    <p className="chunk-snippet">"{m.snippet}"</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="pipeline-step">
                            <span className="step-num">7</span>
                            <div className="step-body">
                              <strong>LLM Answer Generation</strong>
                              <p>Generated answer using model: <code>{msg.pipeline.llmAnswerGeneration.model}</code></p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {msg.contextChunks > 0 && !msg.pipeline && (
                    <div className="context-info">
                      Based on {msg.contextChunks} document chunks {msg.cached && '(Cached from Redis ⚡)'}
                    </div>
                  )}
                </div>
              ))}
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
            <div className="input-area">
              <input 
                type="text" 
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about your document..." 
                onKeyDown={(e) => e.key === 'Enter' && sendQuestion()}
                autoComplete="off"
              />
              <button onClick={sendQuestion} disabled={isLoading || !question.trim()} className="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
