# DocuMind AI - Retrieval-Augmented Generation (RAG) Workspace

This project is a full-stack web application that allows users to upload documents (PDF/TXT) and ask questions about them using a local RAG workflow powered by **Node.js**, **Express**, **MongoDB Vector Search**, and **Google Gemini**.

## Architecture & Steps Implemented

The application perfectly maps to your requested workflow:

- **STEP 1-5 (Upload & Store)**: The frontend allows drag-and-drop of PDF/TXT files. The `/api/upload` endpoint extracts text, splits it into overlapping chunks, generates embeddings using Gemini (`text-embedding-004`), and stores them in MongoDB.
- **STEP 6-11 (Retrieve & Answer)**: The chat interface takes user queries, generates an embedding, uses MongoDB `$vectorSearch` to find the top 5 most similar chunks, and queries the Gemini LLM (`gemini-2.5-pro` compatible alias) for a context-aware answer.

## Prerequisites

1. **MongoDB Atlas Cluster**: You must use MongoDB Atlas as local MongoDB does not natively support `$vectorSearch` without specialized configurations. 
2. **Google Gemini API Key**: Required for embeddings and LLM generation.

## Setup Instructions

1. Configure Environment Variables:
   Open the `.env` file in the root directory and update it with your actual credentials:
   ```env
   MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/rag_db?retryWrites=true&w=majority
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3000
   ```

2. Create a Vector Search Index in MongoDB Atlas:
   To make STEP 8 (Vector similarity search) work, you must define an Atlas Vector Search Index on your `documentchunks` collection. In MongoDB Atlas, go to your cluster -> **Atlas Search** -> **Create Search Index** -> **Atlas Vector Search** (JSON Editor) and use this configuration:
   ```json
   {
     "fields": [
       {
         "type": "vector",
         "path": "embedding",
         "numDimensions": 768,
         "similarity": "cosine"
       }
     ]
   }
   ```
   *Note: Name the index `vector_index` (this name is referenced in `server.js`). The dimensionality `768` is typical for `text-embedding-004`.*

3. Start the Server:
   Run the following command to start your Express server:
   ```bash
   node server.js
   ```

4. Open the App:
   Navigate to `http://localhost:3000` in your browser.

## Tech Stack

- **Frontend**: HTML5, Vanilla JavaScript, CSS3 (Modern Glassmorphism Design).
- **Backend**: Node.js, Express.js, Multer (In-memory storage).
- **AI/ML**: `@google/genai` (Google Generative AI SDK).
- **Database**: Mongoose (MongoDB).
- **Parsers**: `pdf-parse` for PDFs.
