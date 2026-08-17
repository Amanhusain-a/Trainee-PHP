document.addEventListener('DOMContentLoaded', () => {
  const uploadBox = document.getElementById('uploadBox');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const uploadStatus = document.getElementById('uploadStatus');
  
  const chatMessages = document.getElementById('chatMessages');
  const questionInput = document.getElementById('questionInput');
  const sendBtn = document.getElementById('sendBtn');

  // File Upload Handling
  browseBtn.addEventListener('click', () => fileInput.click());

  uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
  });

  uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
  });

  uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      handleFile(fileInput.files[0]);
    }
  });

  async function handleFile(file) {
    if (file.type !== 'application/pdf' && file.type !== 'text/plain') {
      uploadStatus.innerHTML = '<span style="color: #ef4444;">Please upload a PDF or TXT file.</span>';
      return;
    }

    uploadStatus.innerHTML = '<span style="color: var(--text-secondary);">Uploading and analyzing document...</span>';
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (response.ok) {
        uploadStatus.innerHTML = `<span style="color: #10b981;">✓ ${data.message}</span>`;
      } else {
        uploadStatus.innerHTML = `<span style="color: #ef4444;">Error: ${data.error}</span>`;
      }
    } catch (err) {
      uploadStatus.innerHTML = `<span style="color: #ef4444;">Upload failed. Please try again.</span>`;
    }
  }

  // Chat Handling
  function addMessage(content, type, contextChunks = 0) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}-message`;

    let html = `<div class="message-bubble">${content}</div>`;
    
    if (contextChunks > 0) {
      html += `<div class="context-info">Based on ${contextChunks} document chunks</div>`;
    }

    msgDiv.innerHTML = html;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addLoadingIndicator() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ai-message loading';
    msgDiv.id = 'loadingIndicator';
    msgDiv.innerHTML = `
      <div class="message-bubble">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function removeLoadingIndicator() {
    const loader = document.getElementById('loadingIndicator');
    if (loader) loader.remove();
  }

  async function sendQuestion() {
    const question = questionInput.value.trim();
    if (!question) return;

    // Add user message
    addMessage(question, 'user');
    questionInput.value = '';
    sendBtn.disabled = true;
    
    // Add loading
    addLoadingIndicator();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question })
      });
      const data = await response.json();

      removeLoadingIndicator();

      if (response.ok) {
        // Format basic markdown (bold, newlines)
        const formattedAnswer = data.answer
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        addMessage(formattedAnswer, 'ai', data.contextChunks);
      } else {
        addMessage(`Error: ${data.error}`, 'ai');
      }
    } catch (err) {
      removeLoadingIndicator();
      addMessage('Sorry, there was an error processing your request.', 'ai');
    } finally {
      sendBtn.disabled = false;
      questionInput.focus();
    }
  }

  sendBtn.addEventListener('click', sendQuestion);
  questionInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendQuestion();
  });
});
