const { initGemini, LLM_MODEL } = require('../config/gemini');
const { normalizeCellValue } = require('./tableExtractionService');

const ai = initGemini();

/**
 * Multimodal Document Layout Analyzer Engine
 * Analyzes PDF/Image layout page by page, decomposing content into typed elements:
 * - text
 * - table
 * - diagram / chart / flowchart / architecture
 * - image
 */
async function analyzeDocumentLayout(buffer, mimetype, filename) {
  try {
    console.log(`[Layout Analyzer] Performing Multimodal Document Layout Analysis for ${filename}...`);
    const base64Data = buffer.toString('base64');

    const prompt = `You are an expert Multimodal Document AI and Visual Diagram Analysis Engine.
Analyze this document (${filename}) page by page and decompose it into distinct structural layout elements.

For each page, identify and extract elements into an array of typed element objects:
1. "text": Headings, titles, paragraphs, bullet points, numbered lists.
2. "table": Tabular data (headers, rows, columns).
3. "diagram": Flowcharts, architecture diagrams, process maps, schematics, infographics, bar/pie charts, visual diagrams.
4. "image": Photos, illustrations, logos, or decorative graphics.

For "diagram" and "chart" elements:
- Extract "title": The title/header of the diagram or chart (if present).
- Extract "category": One of ("flowchart", "architecture_diagram", "bar_chart", "pie_chart", "process_map", "schematic", "infographic", "decorative").
- Extract "description": Provide a detailed, step-by-step description of the visual layout, all labeled boxes/nodes, connections, workflow arrows (e.g. Step 1 -> Step 2), metrics, legend values, and data relationships.
- Extract "is_decorative": boolean (set true ONLY for uninformative logos, decorative borders, or page divider lines).

Return ONLY a valid JSON array matching this exact schema (no markdown formatting, no commentary):
[
  {
    "page": 1,
    "elements": [
      {
        "element_type": "text",
        "content": "Document Title or Section"
      },
      {
        "element_type": "table",
        "headers": ["ColA", "ColB"],
        "rows": [{ "ColA": "Val1", "ColB": "Val2" }]
      },
      {
        "element_type": "diagram",
        "title": "System Architecture Flow",
        "category": "architecture_diagram",
        "description": "System Architecture showing Client UI communicating via HTTPS with Express Gateway API (Port 5000), which connects to MongoDB for chunk retrieval and Redis for caching.",
        "is_decorative": false
      }
    ]
  }
]

If the document has no visual diagrams or tables, classify all content cleanly into text elements.`;

    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimetype === 'application/pdf' ? 'application/pdf' : (mimetype || 'image/png')
          }
        },
        prompt
      ]
    });

    const rawJson = (response.text || '').replace(/```json|```/g, '').trim();
    if (!rawJson || rawJson === '[]') {
      return null;
    }

    let parsedPages;
    try {
      parsedPages = JSON.parse(rawJson);
    } catch (pErr) {
      console.warn(`[Layout Analyzer] JSON parse warning for ${filename}: ${pErr.message}`);
      return null;
    }

    if (!Array.isArray(parsedPages)) return null;

    const structuredDocument = [];

    parsedPages.forEach(pObj => {
      const pageNum = pObj.page || 1;
      if (!pObj.elements || !Array.isArray(pObj.elements)) return;

      let pendingTextParts = [];

      const flushPendingText = () => {
        if (pendingTextParts.length === 0) return;
        const consolidatedText = pendingTextParts.join('\n\n').trim();
        if (consolidatedText.length > 5) {
          const elemId = `elem_${filename.replace(/[^a-zA-Z0-9]/g, '_')}_p${pageNum}_text_${structuredDocument.length + 1}`;
          structuredDocument.push({
            element_id: elemId,
            element_type: 'text',
            page: pageNum,
            text_content: consolidatedText,
            search_text: consolidatedText
          });
        }
        pendingTextParts = [];
      };

      pObj.elements.forEach((elem, elemIdx) => {
        const elemType = elem.element_type || 'text';
        const elemId = `elem_${filename.replace(/[^a-zA-Z0-9]/g, '_')}_p${pageNum}_${elemIdx + 1}`;

        if (elemType === 'table' && elem.headers && elem.rows) {
          flushPendingText();
          const headers = elem.headers.map(h => String(h).trim());
          const normalizedRows = elem.rows.map(rawRow => {
            const rowObj = {};
            headers.forEach(h => {
              const rawCellVal = rawRow[h] !== undefined ? rawRow[h] : null;
              rowObj[h] = normalizeCellValue(rawCellVal);
            });
            return rowObj;
          });

          const searchLines = [
            `Source: ${filename} | Page: ${pageNum} | Type: Table`,
            `Headers: ${headers.join(' | ')}`
          ];

          normalizedRows.forEach((row, rIdx) => {
            const rowStrs = headers.map(h => `${h}: ${row[h]?.raw_value ?? 'N/A'}`);
            searchLines.push(`Row ${rIdx + 1}: ${rowStrs.join(' | ')}`);
          });

          structuredDocument.push({
            element_id: elemId,
            element_type: 'table',
            page: pageNum,
            headers: headers,
            rows: normalizedRows,
            table_data: {
              headers,
              rows: normalizedRows,
              source: { filename, page: pageNum, sheet: null }
            },
            search_text: searchLines.join('\n')
          });

        } else if (elemType === 'diagram' || elemType === 'chart' || elemType === 'image') {
          flushPendingText();

          // Skip decorative visual noise (logos, page borders, blank icons)
          if (elem.is_decorative || elem.category === 'decorative') {
            console.log(`[Layout Analyzer] Skipped decorative visual graphic on Page ${pageNum}`);
            return;
          }

          const desc = elem.description || elem.content || 'Visual document graphic';
          const titleLine = elem.title ? `Title: ${elem.title}\n` : '';
          const categoryLine = elem.category ? `Category: ${elem.category}\n` : '';

          const searchText = `Source: ${filename} | Page: ${pageNum} | Type: ${elemType.toUpperCase()}\n${titleLine}${categoryLine}Visual Details & Workflow: ${desc}`;

          structuredDocument.push({
            element_id: elemId,
            element_type: elemType,
            page: pageNum,
            diagram_title: elem.title || null,
            diagram_category: elem.category || null,
            diagram_description: desc,
            search_text: searchText
          });

        } else {
          // Collect text content to consolidate
          const textContent = (elem.content || elem.text || '').trim();
          if (textContent.length > 5) {
            pendingTextParts.push(textContent);
          }
        }
      });

      flushPendingText();
    });

    console.log(`[Layout Analyzer] Decomposed ${filename} into ${structuredDocument.length} structured layout elements across ${parsedPages.length} pages.`);
    return structuredDocument;

  } catch (err) {
    console.warn(`[Layout Analyzer] Notice for ${filename}: ${err.message}. Falling back to standard pipeline.`);
    return null;
  }
}

module.exports = {
  analyzeDocumentLayout
};
