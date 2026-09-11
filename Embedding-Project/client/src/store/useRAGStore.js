import { create } from 'zustand';

export const useRAGStore = create((set, get) => ({
  // State
  messages: [
    {
      type: 'ai',
      content: 'Hello! Upload a document (PDF, TXT, or Image for OCR) above, then ask me questions. Advanced RAG with 7-Stage Query Optimization & Multimodal OCR is enabled.'
    }
  ],
  question: '',
  isLoading: false,
  isUploading: false,
  uploadStatus: '',
  isDragOver: false,
  pipelineMode: 'advanced',
  enableChunkFilters: true,
  expandedPipelineIdx: null,
  documents: [],
  totalChunksCount: 0,
  statusTimeoutId: null,

  // Setters
  setQuestion: (question) => set({ question }),
  setIsDragOver: (isDragOver) => set({ isDragOver }),
  setPipelineMode: (mode) => set({ pipelineMode: mode }),
  setEnableChunkFilters: (enabled) => set({ enableChunkFilters: enabled }),

  setTemporaryStatus: (htmlStr, ms = 6000) => {
    const currentTimeout = get().statusTimeoutId;
    if (currentTimeout) clearTimeout(currentTimeout);

    const timeoutId = setTimeout(() => {
      set({ uploadStatus: '', statusTimeoutId: null });
    }, ms);

    set({ uploadStatus: htmlStr, statusTimeoutId: timeoutId });
  },

  fetchDocuments: async () => {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        set({
          documents: data.documents || [],
          totalChunksCount: data.totalChunks || 0
        });
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err.message);
    }
  },

  handleFile: async (file) => {
    const { isUploading, enableChunkFilters, setTemporaryStatus, fetchDocuments } = get();
    if (!file || isUploading) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const allowedExts = ['pdf', 'txt', 'md', 'csv', 'json', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'docx', 'xls', 'xlsx'];
    
    if (!allowedExts.includes(ext) && !file.type.startsWith('image/')) {
      setTemporaryStatus('<span style="color: #ef4444;">Please upload a PDF, DOCX, XLSX, TXT, or Image file.</span>', 6000);
      return;
    }

    set({ isUploading: true });
    const isImg = file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'].includes(ext);
    if (isImg) {
      set({ uploadStatus: '<span style="color: #6366f1;">🔍 Performing OCR on image... Applying DB Chunk Filters...</span>' });
    } else {
      set({ uploadStatus: '<span style="color: var(--text-secondary);">Uploading and analyzing document with DB Chunk Filters... Please wait.</span>' });
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('enableChunkFilters', 'true');

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const contentType = response.headers.get('content-type');
      let data = {};
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      }

      if (response.ok && data.message) {
        const ocrBadge = data.ocrUsed ? ' <span class="ocr-status-badge">⚡ OCR Extracted</span>' : '';
        const filterBadge = (data.filteredCount && data.filteredCount > 0) ? ` <span class="ocr-status-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🛡️ Filtered ${data.filteredCount} Noise Chunks</span>` : '';
        setTemporaryStatus(`<span style="color: #10b981;">✓ ${data.message}${ocrBadge}${filterBadge}</span>`, 7000);
        fetchDocuments();
      } else {
        let errStr = data.error || `Upload server returned error status ${response.status}`;
        setTemporaryStatus(`<span style="color: #ef4444;">Error: ${errStr}</span>`, 8000);
      }
    } catch (err) {
      setTemporaryStatus('<span style="color: #ef4444;">Upload failed. Please try again.</span>', 5000);
    } finally {
      set({ isUploading: false });
    }
  },

  sendQuestion: async (scrollToBottom) => {
    const { question, pipelineMode, isLoading } = get();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) return;

    set((state) => ({
      messages: [...state.messages, { type: 'user', content: trimmedQuestion }],
      question: '',
      isLoading: true
    }));

    if (scrollToBottom) setTimeout(scrollToBottom, 100);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmedQuestion, mode: pipelineMode })
      });

      const contentType = response.headers.get('content-type');
      let data = {};
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      }

      if (response.ok && data.answer) {
        set((state) => ({
          messages: [
            ...state.messages,
            {
              type: 'ai',
              content: data.answer,
              contextChunks: data.contextChunks,
              cached: data.cached,
              pipeline: data.pipeline
            }
          ],
          isLoading: false
        }));
      } else {
        let errStr = data.error || `Server returned error status ${response.status}`;
        if (typeof errStr === 'string' && errStr.trim().startsWith('{')) {
          try {
            const parsedErr = JSON.parse(errStr);
            if (parsedErr.error && parsedErr.error.message) {
              errStr = parsedErr.error.message;
            }
          } catch (e) {}
        }
        
        if (errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand')) {
          errStr = 'Gemini AI service is currently experiencing temporary high demand (503). Automatic retries were performed. Please wait a few seconds and try sending your question again.';
        }

        set((state) => ({
          messages: [...state.messages, { type: 'ai', content: errStr }],
          isLoading: false
        }));
      }
    } catch (err) {
      set((state) => ({
        messages: [...state.messages, { type: 'ai', content: 'Sorry, there was an error processing your request. Please try again.' }],
        isLoading: false
      }));
    }

    if (scrollToBottom) setTimeout(scrollToBottom, 100);
  },

  togglePipelineInspector: (idx, scrollToBottom) => {
    set((state) => {
      const nextIdx = state.expandedPipelineIdx === idx ? null : idx;
      if (nextIdx !== null && scrollToBottom) {
        setTimeout(scrollToBottom, 150);
      }
      return { expandedPipelineIdx: nextIdx };
    });
  },

  clearKnowledgeBase: async () => {
    const { setTemporaryStatus } = get();
    if (!window.confirm('Are you sure you want to clear all uploaded documents and reset the vector store?')) return;
    try {
      const res = await fetch('/api/documents', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setTemporaryStatus(`<span style="color: #10b981;">✓ ${data.message}</span>`, 5000);
        set({ documents: [], totalChunksCount: 0 });
      }
    } catch (err) {
      setTemporaryStatus('<span style="color: #ef4444;">Failed to clear documents.</span>', 5000);
    }
  }
}));
