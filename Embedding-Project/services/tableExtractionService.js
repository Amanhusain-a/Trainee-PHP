const xlsx = require('xlsx');
const { initGemini, LLM_MODEL } = require('../config/gemini');

const ai = initGemini();

/**
 * Normalizes raw cell values into raw_value & normalized_value
 */
function normalizeCellValue(val) {
  if (val === null || val === undefined || val === '') {
    return { raw_value: null, normalized_value: null };
  }

  if (typeof val === 'number') {
    return { raw_value: String(val), normalized_value: val };
  }

  if (typeof val === 'boolean') {
    return { raw_value: val ? 'TRUE' : 'FALSE', normalized_value: val };
  }

  if (val instanceof Date) {
    return { raw_value: val.toLocaleDateString(), normalized_value: val.toISOString().split('T')[0] };
  }

  const strVal = String(val).trim();
  if (!strVal) return { raw_value: null, normalized_value: null };

  // Check if currency/formatted number (e.g. "₹25,000", "$15,000.50", "25,000")
  const currencyMatch = strVal.match(/^[₹$\€\£\¥\s]*([+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)[%]?$/);
  if (currencyMatch) {
    const rawNumStr = currencyMatch[1].replace(/,/g, '');
    const num = Number(rawNumStr);
    if (!isNaN(num)) {
      return { raw_value: strVal, normalized_value: num };
    }
  }

  // Check if standard date string (e.g., "31/08/2026", "2026-08-31")
  const dateMatch = strVal.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
  if (dateMatch) {
    return { raw_value: strVal, normalized_value: strVal };
  }

  return { raw_value: strVal, normalized_value: strVal };
}

/**
 * Unrolls merged cells in a SheetJS worksheet so child cells inherit parent values
 */
function resolveMergedCells(sheet) {
  if (!sheet || !sheet['!merges']) return;

  sheet['!merges'].forEach(range => {
    const startCell = xlsx.utils.encode_cell(range.s);
    const parentVal = sheet[startCell];
    if (!parentVal) return;

    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellRef = xlsx.utils.encode_cell({ r: R, c: C });
        if (!sheet[cellRef]) {
          sheet[cellRef] = { ...parentVal };
        }
      }
    }
  });
}

/**
 * Excel Table Extraction Engine (.xlsx & .xls)
 * Preserves sheets, headers, rows, columns, merged cells, and data types without OCR
 */
function extractTablesFromExcel(buffer, filename) {
  try {
    console.log(`[Table Extraction] Processing Excel file: ${filename}...`);
    const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true, cellFormulas: true });
    const structuredTables = [];

    workbook.SheetNames.forEach((sheetName, sheetIdx) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet['!ref']) return;

      // Handle merged cells
      resolveMergedCells(sheet);

      // Convert sheet to 2D matrix array with defval null (prevents column shifting!)
      const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      if (!matrix || matrix.length === 0) return;

      // Find first non-empty row to use as header candidate
      let headerRowIdx = -1;
      for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r];
        if (row && row.some(cell => cell !== null && cell !== '')) {
          headerRowIdx = r;
          break;
        }
      }

      if (headerRowIdx === -1) return;

      const rawHeaders = matrix[headerRowIdx].map((h, i) => (h !== null && h !== undefined && String(h).trim() !== '') ? String(h).trim() : `Column_${i + 1}`);
      const headers = rawHeaders;

      const rows = [];
      for (let r = headerRowIdx + 1; r < matrix.length; r++) {
        const rowArray = matrix[r];
        if (!rowArray || rowArray.every(c => c === null || c === '')) continue;

        const rowObj = {};
        let hasValue = false;

        headers.forEach((header, colIdx) => {
          const rawCell = rowArray[colIdx] !== undefined ? rowArray[colIdx] : null;
          const cellObj = normalizeCellValue(rawCell);
          rowObj[header] = cellObj;
          if (cellObj.normalized_value !== null) hasValue = true;
        });

        if (hasValue) {
          rows.push(rowObj);
        }
      }

      if (rows.length === 0) return;

      const tableId = `table_excel_${sheetIdx + 1}_1`;
      
      // Construct Search Text representation for Vector Search
      const searchLines = [
        `Source: ${filename} | Sheet: ${sheetName}`,
        `Headers: ${headers.join(' | ')}`
      ];

      rows.forEach((row, rIdx) => {
        const rowStrs = headers.map(h => `${h}: ${row[h]?.raw_value ?? 'N/A'}`);
        searchLines.push(`Row ${rIdx + 1}: ${rowStrs.join(' | ')}`);
      });

      const searchText = searchLines.join('\n');

      structuredTables.push({
        type: 'table',
        element_id: tableId,
        element_type: 'table',
        source: {
          filename: filename,
          page: null,
          sheet: sheetName
        },
        headers: headers,
        rows: rows,
        search_text: searchText
      });
    });

    console.log(`[Table Extraction] Extracted ${structuredTables.length} structured tables from Excel: ${filename}`);
    return structuredTables;

  } catch (err) {
    console.error(`[Table Extraction] Excel processing failed for ${filename}:`, err);
    return [];
  }
}

/**
 * Deterministic PDF Text Table Parser
 * Extracts structured tables from text extracted by pdf-parse
 */
function parseTablesFromPdfText(text, filename) {
  if (!text) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const detectedTables = [];

  let currentHeaders = null;
  let currentRawRows = [];
  let tableCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Clean pipe-formatted markdown tables like "| Header 1 | Header 2 |"
    let cleanLine = line;
    if (cleanLine.startsWith('|') && cleanLine.endsWith('|')) {
      cleanLine = cleanLine.substring(1, cleanLine.length - 1);
    }
    
    // Ignore markdown header separator lines like "|---|---|---|"
    if (/^[\|\-\:\s]+$/.test(line) || /^(?:\s*[\-\:\=]{2,}\s*\|?)+$/.test(line)) {
      continue;
    }

    // Split line by 2+ spaces, tabs, or pipes '|'
    const columns = cleanLine
      .split(/\s{2,}|\t|\|/)
      .map(c => c.trim())
      .filter(Boolean);

    if (columns.length >= 2) {
      // Ignore key-value pair lines like "Date: 31/08/2026" or "Invoice #: 1001"
      if (line.includes(':')) {
        continue;
      }

      // Check if this line looks like a header row (must not contain numeric data cells)
      const lowerCols = columns.map(c => c.toLowerCase());
      const hasHeaderKeywords = lowerCols.some(c => 
        /\b(product|item|description|qty|quantity|price|amount|total|date|rate|id|name|unit|cost|particulars|subtotal)\b/i.test(c)
      );

      const hasNumericValues = columns.some(c => /^[\$₹\€\£\¥]?\d+(?:,\d{3})*(?:\.\d+)?$/.test(c.trim()));

      const isHeaderCandidate = hasHeaderKeywords && !hasNumericValues && (
        columns.every(c => !/^\d+(\.\d+)?$/.test(c)) &&
        columns.length >= 2
      );

      if (isHeaderCandidate && (!currentHeaders || currentRawRows.length > 0)) {
        if (currentHeaders && currentRawRows.length > 0) {
          tableCount++;
          detectedTables.push({
            table_id: `table_pdf_1_${tableCount}`,
            headers: currentHeaders,
            rows: currentRawRows
          });
        }
        currentHeaders = columns;
        currentRawRows = [];
        continue;
      }

      if (currentHeaders) {
        // If line is a total/summary line, end table block
        const firstColLower = columns[0].toLowerCase();
        if (firstColLower.startsWith('total') || firstColLower.startsWith('subtotal') || firstColLower.startsWith('grand total') || firstColLower.startsWith('amount due')) {
          tableCount++;
          detectedTables.push({
            table_id: `table_pdf_1_${tableCount}`,
            headers: currentHeaders,
            rows: currentRawRows
          });
          currentHeaders = null;
          currentRawRows = [];
          continue;
        }

        if (Math.abs(columns.length - currentHeaders.length) <= 1) {
          currentRawRows.push(columns);
        }
      }
    } else {
      if (currentHeaders && currentRawRows.length > 0) {
        tableCount++;
        detectedTables.push({
          table_id: `table_pdf_1_${tableCount}`,
          headers: currentHeaders,
          rows: currentRawRows
        });
        currentHeaders = null;
        currentRawRows = [];
      }
    }
  }

  if (currentHeaders && currentRawRows.length > 0) {
    tableCount++;
    detectedTables.push({
      table_id: `table_pdf_1_${tableCount}`,
      headers: currentHeaders,
      rows: currentRawRows
    });
  }

  return detectedTables.map(tbl => {
    const headers = tbl.headers;
    const normalizedRows = tbl.rows.map(rowArr => {
      const rowObj = {};
      headers.forEach((h, colIdx) => {
        const rawCell = rowArr[colIdx] !== undefined ? rowArr[colIdx] : null;
        rowObj[h] = normalizeCellValue(rawCell);
      });
      return rowObj;
    });

    const searchLines = [
      `Source: ${filename} | Page: 1`,
      `Headers: ${headers.join(' | ')}`
    ];

    normalizedRows.forEach((row, rIdx) => {
      const rowStrs = headers.map(h => `${h}: ${row[h]?.raw_value ?? 'N/A'}`);
      searchLines.push(`Row ${rIdx + 1}: ${rowStrs.join(' | ')}`);
    });

    return {
      type: 'table',
      element_id: tbl.table_id,
      element_type: 'table',
      source: {
        filename: filename,
        page: 1,
        sheet: null
      },
      headers: headers,
      rows: normalizedRows,
      search_text: searchLines.join('\n')
    };
  });
}

/**
 * PDF Table Extraction Engine (Text & Scanned OCR PDFs)
 * Multi-stage: 1. Instant Text Alignment Parsing; 2. Gemini Multimodal Document Engine
 */
async function extractTablesFromPdf(buffer, filename, pdfText = '') {
  try {
    console.log(`[Table Extraction] Scanning PDF for structured tables: ${filename}...`);

    // Stage 1: Deterministic text-based table extraction
    if (pdfText && pdfText.trim()) {
      const textTables = parseTablesFromPdfText(pdfText, filename);
      if (textTables.length > 0) {
        console.log(`[Table Extraction] Deterministic PDF parser extracted ${textTables.length} tables from ${filename}.`);
        return textTables;
      }
    }

    // Stage 2: Gemini Vision Multimodal OCR Table Parser
    const base64Data = buffer.toString('base64');

    const prompt = `You are a document table extraction AI. Analyze this PDF document buffer and detect ALL tables.
Extract each table in a structured JSON format preserving headers, rows, columns, header titles, and page numbers.

Return ONLY a valid JSON array of table objects matching this exact schema (no markdown wrap, no explanations):
[
  {
    "page": 1,
    "headers": ["Product", "Quantity", "Price"],
    "rows": [
      {
        "Product": "Ajwa Dates",
        "Quantity": "100",
        "Price": "₹25,000"
      }
    ]
  }
]

If no tables exist, return [].`;

    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: 'application/pdf'
          }
        },
        prompt
      ]
    });

    const rawJson = (response.text || '').replace(/```json|```/g, '').trim();
    if (!rawJson || rawJson === '[]') return [];

    let parsedTables;
    try {
      parsedTables = JSON.parse(rawJson);
    } catch (pErr) {
      console.warn(`[Table Extraction] Could not parse Gemini table JSON for ${filename}: ${pErr.message}`);
      return [];
    }

    if (!Array.isArray(parsedTables)) return [];

    const structuredTables = [];

    parsedTables.forEach((tbl, idx) => {
      if (!tbl.headers || !Array.isArray(tbl.headers) || !tbl.rows || !Array.isArray(tbl.rows)) return;

      const headers = tbl.headers.map(h => String(h).trim());
      const pageNum = tbl.page || 1;
      const tableId = `table_pdf_p${pageNum}_${idx + 1}`;

      const normalizedRows = tbl.rows.map(rawRow => {
        const rowObj = {};
        headers.forEach(h => {
          const rawCellVal = rawRow[h] !== undefined ? rawRow[h] : null;
          rowObj[h] = normalizeCellValue(rawCellVal);
        });
        return rowObj;
      });

      const searchLines = [
        `Source: ${filename} | Page: ${pageNum}`,
        `Headers: ${headers.join(' | ')}`
      ];

      normalizedRows.forEach((row, rIdx) => {
        const rowStrs = headers.map(h => `${h}: ${row[h]?.raw_value ?? 'N/A'}`);
        searchLines.push(`Row ${rIdx + 1}: ${rowStrs.join(' | ')}`);
      });

      const searchText = searchLines.join('\n');

      structuredTables.push({
        type: 'table',
        element_id: tableId,
        element_type: 'table',
        source: {
          filename: filename,
          page: pageNum,
          sheet: null
        },
        headers: headers,
        rows: normalizedRows,
        search_text: searchText
      });
    });

    console.log(`[Table Extraction] Extracted ${structuredTables.length} structured tables from PDF: ${filename}`);
    return structuredTables;

  } catch (err) {
    console.warn(`[Table Extraction] PDF table extraction notice for ${filename}: ${err.message}`);
    return [];
  }
}

/**
 * Numerical Analysis Helper for RAG Retrieval
 * Performs deterministic calculations (SUM, COUNT, AVG, MAX, MIN) on structured table data
 */
function performNumericalTableAnalysis(question, tableData) {
  if (!tableData || !tableData.headers || !tableData.rows || tableData.rows.length === 0) return null;

  const qLower = question.toLowerCase();
  const isSum = qLower.includes('total') || qLower.includes('sum') || qLower.includes('altogether');
  const isCount = qLower.includes('count') || qLower.includes('how many') || qLower.includes('number of');
  const isAvg = qLower.includes('average') || qLower.includes('avg') || qLower.includes('mean');
  const isMax = qLower.includes('maximum') || qLower.includes('max') || qLower.includes('highest') || qLower.includes('most expensive');
  const isMin = qLower.includes('minimum') || qLower.includes('min') || qLower.includes('lowest') || qLower.includes('cheapest');

  if (!isSum && !isCount && !isAvg && !isMax && !isMin) return null;

  // Find numerical columns
  const numericCols = tableData.headers.filter(h => {
    let numCount = 0;
    tableData.rows.forEach(r => {
      if (typeof r[h]?.normalized_value === 'number') numCount++;
    });
    return numCount > 0;
  });

  if (numericCols.length === 0) return null;

  const analyticsResults = [];

  numericCols.forEach(col => {
    const nums = tableData.rows
      .map(r => r[col]?.normalized_value)
      .filter(v => typeof v === 'number');

    if (nums.length === 0) return;

    const sumVal = nums.reduce((a, b) => a + b, 0);
    const countVal = nums.length;
    const avgVal = sumVal / countVal;
    const maxVal = Math.max(...nums);
    const minVal = Math.min(...nums);

    analyticsResults.push({
      column: col,
      sum: sumVal,
      count: countVal,
      average: Number(avgVal.toFixed(2)),
      max: maxVal,
      min: minVal
    });
  });

  return {
    headers: tableData.headers,
    rowCount: tableData.rows.length,
    numericAnalytics: analyticsResults
  };
}

module.exports = {
  normalizeCellValue,
  extractTablesFromExcel,
  extractTablesFromPdf,
  performNumericalTableAnalysis
};
