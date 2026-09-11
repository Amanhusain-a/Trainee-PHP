const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const DocumentChunk = require('../models/DocumentChunk');
const { extractTextFromPdf, extractTextWithOCR, extractTextFromDocx, extractTextFromExcel, estimateTokens, splitTextIntoChunks, calculateQualityScore, assessDocumentQuality, normalizeText } = require('../services/extractionService');
const { extractTablesFromExcel, extractTablesFromPdf } = require('../services/tableExtractionService');
const { analyzeDocumentLayout } = require('../services/layoutAnalyzerService');
const { embedWithRetry } = require('../services/embeddingService');
const { evaluateChunkForStorage } = require('../services/chunkFilterService');

const handleUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Step 1: Calculate File SHA-256 for Idempotency
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const existingFile = await DocumentChunk.findOne({ fileHash });
    
    if (existingFile) {
      console.log(`[Idempotent] File ${req.file.originalname} (hash: ${fileHash}) already indexed. Skipping.`);
      return res.json({
        message: 'Document already up to date. 0 new chunks indexed.',
        duplicate: true,
        filename: req.file.originalname,
        fileHash
      });
    }

    // Step 1.2: Configure Store Chunk Filtering Options (Always Active)
    const filterOptions = {
      enableChunkFilters: true,
      minQualityScore: req.body?.minQualityScore ? parseFloat(req.body.minQualityScore) : 0.20,
      minAlphaRatio: req.body?.minAlphaRatio ? parseFloat(req.body.minAlphaRatio) : 0.15,
      minLength: req.body?.minLength ? parseInt(req.body.minLength, 10) : 15,
      minWordCount: req.body?.minWordCount ? parseInt(req.body.minWordCount, 10) : 3,
      enableHeaderFooterFilter: true,
      enableQualityFilter: true,
      enableMinLengthFilter: true,
      enableAlphaDensityFilter: true
    };

    let text = '';
    let ocrUsed = false;
    let ocrProvider = null;
    let parserVersion = 'standard-v1';
    let numPages = 1;
    let structuredTables = [];
    
    const filename = req.file.originalname;
    const mimetype = req.file.mimetype || '';
    const ext = path.extname(filename).toLowerCase();
    const isImage = mimetype.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'].includes(ext);

    // Step 1.5 - Save Raw File Locally
    let savedFilename = `${Date.now()}_${filename}`;
    let imageUrl = null;
    try {
      const uploadsDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const localFilePath = path.join(uploadsDir, savedFilename);
      fs.writeFileSync(localFilePath, req.file.buffer);
      if (isImage) {
        imageUrl = `/uploads/${savedFilename}`;
      }
      console.log(`Saved ${filename} locally to ${localFilePath}`);
    } catch (saveErr) {
      console.error('Failed to save file locally:', saveErr.message);
    }

    // Load existing chunk hashes for this filename to reuse unchanged embeddings
    const existingChunks = await DocumentChunk.find({ 'metadata.filename': filename }, 'chunkHash embedding');
    const oldEmbeddingsMap = new Map();
    existingChunks.forEach(c => {
      if (c.chunkHash && c.embedding) oldEmbeddingsMap.set(c.chunkHash, c.embedding);
    });
    if (existingChunks.length > 0) {
      console.log(`[Re-process] Found ${existingChunks.length} existing chunks for ${filename}. Deleting old records and reusing unchanged embeddings.`);
      await DocumentChunk.deleteMany({ 'metadata.filename': filename });
    }

    let storedCount = 0;
    let reusedCount = 0;
    let filteredCount = 0;
    const filterSummary = {
      MIN_LENGTH_FILTER: 0,
      ALPHANUMERIC_DENSITY_FILTER: 0,
      HEADER_FOOTER_NOISE_FILTER: 0,
      OCR_QUALITY_FILTER: 0
    };

    // Step 1.8: Try Multimodal Document Layout Analysis (PDF / Images)
    if (mimetype === 'application/pdf' || ext === '.pdf' || isImage) {
      const layoutElements = await analyzeDocumentLayout(req.file.buffer, mimetype, filename);
      
      if (layoutElements && layoutElements.length > 0) {
        console.log(`[Layout Pipeline] Evaluating and indexing ${layoutElements.length} decomposed layout elements for ${filename}...`);

        for (let elemIdx = 0; elemIdx < layoutElements.length; elemIdx++) {
          const elem = layoutElements[elemIdx];
          
          // Apply Chunk Filtering before storing to DB
          const evalResult = evaluateChunkForStorage(elem.search_text, {
            ...filterOptions,
            isTable: elem.element_type === 'table',
            isDiagram: elem.element_type === 'diagram' || elem.element_type === 'chart'
          });

          if (!evalResult.passed) {
            filteredCount++;
            if (evalResult.filterApplied) {
              filterSummary[evalResult.filterApplied] = (filterSummary[evalResult.filterApplied] || 0) + 1;
            }
            console.log(`[DB Store Filter] Skipped layout element ${elemIdx + 1} due to filter '${evalResult.filterApplied}': ${evalResult.reason}`);
            continue;
          }

          const cleanedText = evalResult.cleanedText;
          const chunkHash = crypto.createHash('sha256').update(`${elem.element_id}_${cleanedText}`).digest('hex');
          let embedding;

          if (oldEmbeddingsMap.has(chunkHash)) {
            embedding = oldEmbeddingsMap.get(chunkHash);
            reusedCount++;
          } else {
            if (storedCount > 0) {
              await new Promise(r => setTimeout(r, 2000));
            }
            embedding = await embedWithRetry(cleanedText);
          }

          await DocumentChunk.create({
            text: cleanedText,
            embedding: embedding,
            fileHash: fileHash,
            chunkHash: chunkHash,
            metadata: {
              chunk_type: elem.element_type,
              element_type: elem.element_type,
              element_id: elem.element_id,
              page: elem.page,
              filename: filename,
              savedFilename: savedFilename,
              imageUrl: imageUrl,
              fileType: ext.replace('.', '').toUpperCase() || 'DOC',
              table_data: elem.table_data || null,
              diagram_description: elem.diagram_description || null,
              token_count: evalResult.metrics.tokenCount,
              quality_score: evalResult.metrics.qualityScore,
              quality_status: 'HIGH_QUALITY',
              ocrUsed: true,
              filter_status: 'PASSED',
              filter_applied: null,
              filter_metrics: evalResult.metrics
            }
          });
          storedCount++;
        }

        return res.json({
          message: `Multimodal Layout AI successfully indexed ${storedCount} elements from ${filename}.${filteredCount > 0 ? ` (${filteredCount} noise elements filtered out during DB storage)` : ''}`,
          filename,
          storedCount,
          filteredCount,
          reusedCount,
          filterSummary,
          layoutAnalysis: true
        });
      }
    }

    // Step 2: Fallback Extract Text & Structured Tables (PDF, Text, Excel, Word, or OCR Images)
    if (mimetype === 'application/pdf' || ext === '.pdf') {
      parserVersion = 'pdf-parse-v1.1.1';
      const result = await extractTextFromPdf(req.file.buffer, filename);
      text = result.text;
      ocrUsed = result.ocrUsed;
      if (ocrUsed) ocrProvider = 'paddleocr-v4/multimodal';
      numPages = Math.max(1, Math.ceil(text.length / 3000));
      
      // PDF Table Extraction (Dual-stage: Text layout alignment + Multimodal Vision OCR)
      structuredTables = await extractTablesFromPdf(req.file.buffer, filename, text);

    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
      parserVersion = 'mammoth-docx-parser';
      text = await extractTextFromDocx(req.file.buffer, filename);
      numPages = Math.max(1, Math.ceil(text.length / 3000));
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimetype === 'application/vnd.ms-excel' || ext === '.xlsx' || ext === '.xls') {
      parserVersion = 'sheetjs-excel-parser';
      text = await extractTextFromExcel(req.file.buffer, filename);

      // Excel Structured Table Extraction (No OCR used)
      structuredTables = extractTablesFromExcel(req.file.buffer, filename);

    } else if (mimetype === 'text/plain' || mimetype === 'text/markdown' || mimetype === 'text/csv' || ext === '.txt' || ext === '.md' || ext === '.json') {
      text = req.file.buffer.toString('utf8');
      parserVersion = 'native-text-parser';
    } else if (isImage) {
      ocrUsed = true;
      ocrProvider = 'paddleocr-v4/multimodal';
      parserVersion = 'paddleocr-vision-engine';
      text = await extractTextWithOCR(req.file.buffer, mimetype || 'image/png', filename);
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, XLSX, TXT, MD, CSV, or Image (PNG, JPG, WEBP, BMP, TIFF).' });
    }

    if ((!text || !text.trim()) && structuredTables.length === 0) {
      return res.status(400).json({ error: 'Extracted text and tables are empty. The image or document could not be read.' });
    }

    // Step 3: Normalize text & Quality Scan
    text = normalizeText(text);
    const qualityAssessment = assessDocumentQuality(text || 'Table data present');
    console.log(`[Quality Scan] ${filename} -> Score: ${qualityAssessment.score}, Status: ${qualityAssessment.status}, Readability: ${qualityAssessment.reason}`);

    if (qualityAssessment.isUnreadable && structuredTables.length === 0) {
      return res.status(422).json({
        error: `⚠️ Unreadable OCR Scan Detected! The document image or scan is unreadable (blurry image, poor lighting, severe distortion, or garbled characters). Quality Score: ${(qualityAssessment.score * 100).toFixed(0)}%. Please re-upload a clearer image or document.`,
        unreadable: true,
        qualityAssessment
      });
    }

    // Step 4: Index Structured Tables Separately with Chunk Filters Applied
    for (let tIdx = 0; tIdx < structuredTables.length; tIdx++) {
      const tbl = structuredTables[tIdx];
      const evalResult = evaluateChunkForStorage(tbl.search_text, {
        ...filterOptions,
        isTable: true
      });

      if (!evalResult.passed) {
        filteredCount++;
        if (evalResult.filterApplied) {
          filterSummary[evalResult.filterApplied] = (filterSummary[evalResult.filterApplied] || 0) + 1;
        }
        console.log(`[DB Store Filter] Skipped table ${tIdx + 1} due to filter '${evalResult.filterApplied}': ${evalResult.reason}`);
        continue;
      }

      const cleanedText = evalResult.cleanedText;
      const chunkHash = crypto.createHash('sha256').update(`${tbl.element_id}_${cleanedText}`).digest('hex');
      let embedding;

      if (oldEmbeddingsMap.has(chunkHash)) {
        embedding = oldEmbeddingsMap.get(chunkHash);
        reusedCount++;
      } else {
        if (storedCount > 0) {
          await new Promise(r => setTimeout(r, 2000));
        }
        embedding = await embedWithRetry(cleanedText);
      }

      await DocumentChunk.create({
        text: cleanedText,
        embedding: embedding,
        fileHash: fileHash,
        chunkHash: chunkHash,
        metadata: {
          chunk_type: 'table',
          element_type: 'table',
          table_id: tbl.element_id,
          sheet: tbl.source.sheet,
          page: tbl.source.page || 1,
          token_count: evalResult.metrics.tokenCount,
          filename: filename,
          savedFilename: savedFilename,
          fileType: ext.replace('.', '').toUpperCase() || 'TABLE',
          ocrUsed: ocrUsed,
          filter_status: 'PASSED',
          filter_applied: null,
          filter_metrics: evalResult.metrics,
          table_data: {
            headers: tbl.headers,
            rows: tbl.rows,
            source: tbl.source
          }
        }
      });
      storedCount++;
    }

    // Step 5: Index Standard Narrative Chunks with Quality & Noise Filtering
    const isExcel = mimetype.includes('spreadsheet') || mimetype.includes('excel') || ['.xlsx', '.xls'].includes(ext);
    if (!isExcel || structuredTables.length === 0) {
      const chunks = splitTextIntoChunks(text, 2000, 200);
      for (let i = 0; i < chunks.length; i++) {
        const rawChunkText = chunks[i].trim();
        if (!rawChunkText) continue;

        const evalResult = evaluateChunkForStorage(rawChunkText, filterOptions);

        if (!evalResult.passed) {
          filteredCount++;
          if (evalResult.filterApplied) {
            filterSummary[evalResult.filterApplied] = (filterSummary[evalResult.filterApplied] || 0) + 1;
          }
          console.log(`[DB Store Filter] Skipped chunk ${i + 1} due to filter '${evalResult.filterApplied}': ${evalResult.reason}`);
          continue;
        }

        const cleanedChunkText = evalResult.cleanedText;
        const pageNumber = Math.min(numPages, Math.max(1, Math.ceil((i + 1) / (chunks.length / numPages))));
        const chunkHash = crypto.createHash('sha256').update(`${pageNumber}_${cleanedChunkText}`).digest('hex');
        let embedding;

        if (oldEmbeddingsMap.has(chunkHash)) {
          embedding = oldEmbeddingsMap.get(chunkHash);
          reusedCount++;
        } else {
          if (storedCount > 0) {
            await new Promise(r => setTimeout(r, 2000));
          }
          embedding = await embedWithRetry(cleanedChunkText);
        }

        await DocumentChunk.create({
          text: cleanedChunkText,
          embedding: embedding,
          fileHash: fileHash,
          chunkHash: chunkHash,
          metadata: {
            chunk_type: 'text',
            element_type: 'text',
            token_count: evalResult.metrics.tokenCount,
            page: pageNumber,
            num_pages: numPages,
            parser_version: parserVersion,
            content_source: ocrUsed ? 'ocr' : 'native',
            ocr_applied: ocrUsed,
            ocr_confidence: ocrUsed ? 0.98 : null,
            quality_score: evalResult.metrics.qualityScore,
            quality_status: qualityAssessment.status,
            ocr_provider: ocrProvider,
            filename: filename,
            savedFilename: savedFilename,
            imageUrl: imageUrl,
            chunkIndex: i,
            fileType: ext.replace('.', '').toUpperCase() || 'DOC',
            ocrUsed: ocrUsed,
            filter_status: 'PASSED',
            filter_applied: null,
            filter_metrics: evalResult.metrics
          }
        });
        storedCount++;
      }
    }

    res.json({
      message: `Successfully processed and stored ${storedCount} clean chunks from ${filename}.${filteredCount > 0 ? ` (Filtered out ${filteredCount} noise chunks during DB storage)` : ''}`,
      ocrUsed,
      chunksCount: storedCount,
      filteredCount,
      reusedCount,
      filterSummary,
      filename,
      imageUrl,
      fileHash,
      extractedLength: text.length
    });

  } catch (error) {
    console.error('Error processing upload:', error);
    let errMsg = error.message || 'Error processing file upload.';
    if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota exceeded')) {
      errMsg = 'Gemini API Rate Limit reached (429). Please wait 10-15 seconds and try uploading again.';
    }
    res.status(500).json({ error: errMsg });
  }
};

module.exports = { handleUpload };
