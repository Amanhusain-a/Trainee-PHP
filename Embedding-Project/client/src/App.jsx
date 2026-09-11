import { useEffect } from 'react';
import Header from './components/Header';
import FileUploader from './components/KnowledgeBase/FileUploader';
import DocumentList from './components/KnowledgeBase/DocumentList';
import PipelineConfig from './components/KnowledgeBase/PipelineConfig';
import ChatContainer from './components/Chat/ChatContainer';
import { useRAGStore } from './store/useRAGStore';

function App() {
  const fetchDocuments = useRAGStore((state) => state.fetchDocuments);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  return (
    <div className="app-container">
      <Header />

      <main className="main-content">
        <section className="upload-section">
          <h2>Knowledge Base</h2>
          <FileUploader />
          <DocumentList />
          <PipelineConfig />
        </section>

        <ChatContainer />
      </main>
    </div>
  );
}

export default App;
