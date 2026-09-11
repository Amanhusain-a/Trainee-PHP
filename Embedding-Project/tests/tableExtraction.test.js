const xlsx = require('xlsx');
const { extractTablesFromExcel, extractTablesFromPdf, normalizeCellValue, performNumericalTableAnalysis } = require('../services/tableExtractionService');

async function runTests() {
  console.log('====================================================');
  console.log('      TABLE EXTRACTION COMPREHENSIVE TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // --- Test 1: Value Normalization ---
  console.log('--- TEST 1: Value Normalization ---');
  const currencyRes = normalizeCellValue('₹25,000');
  assert(currencyRes.raw_value === '₹25,000' && currencyRes.normalized_value === 25000, 'Currency parsing (₹25,000 -> 25000)');

  const numberRes = normalizeCellValue(100);
  assert(numberRes.raw_value === '100' && numberRes.normalized_value === 100, 'Number parsing (100 -> 100)');

  const emptyRes = normalizeCellValue('');
  assert(emptyRes.raw_value === null && emptyRes.normalized_value === null, 'Empty cell handling (empty string -> null)');

  // --- Test 2: Excel Extraction (Multi-sheet, Empty Cells, Merged Cells, Data Types) ---
  console.log('\n--- TEST 2: Excel Table Extraction ---');
  const wb = xlsx.utils.book_new();

  // Sheet 1: Products
  const ws1Data = [
    ['Product', 'Quantity', 'Price'],
    ['Ajwa Dates', 100, '₹25,000'],
    ['Medjool Dates', 50, '₹15,000'],
    ['Empty Item', null, '₹5,000']
  ];
  const ws1 = xlsx.utils.aoa_to_sheet(ws1Data);
  xlsx.utils.book_append_sheet(wb, ws1, 'Products');

  // Sheet 2: Customers
  const ws2Data = [
    ['Customer ID', 'Customer Name', 'City'],
    ['C001', 'Rahul Sharma', 'Mumbai'],
    ['C002', 'Priya Patel', 'Delhi']
  ];
  const ws2 = xlsx.utils.aoa_to_sheet(ws2Data);
  xlsx.utils.book_append_sheet(wb, ws2, 'Customers');

  const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const excelTables = extractTablesFromExcel(excelBuffer, 'test_products.xlsx');

  assert(excelTables.length === 2, 'Multi-sheet extraction (Extracted 2 tables for 2 sheets)');

  const prodTable = excelTables.find(t => t.source.sheet === 'Products');
  assert(prodTable !== undefined, 'Sheet 1 (Products) found');
  assert(prodTable.headers.join(',') === 'Product,Quantity,Price', 'Headers preserved (Product, Quantity, Price)');
  assert(prodTable.rows.length === 3, 'All rows extracted correctly (3 data rows)');

  // Verify empty cell non-shifting column integrity
  const emptyRow = prodTable.rows[2];
  assert(emptyRow.Product.normalized_value === 'Empty Item', 'Row 3 Product value preserved');
  assert(emptyRow.Quantity.normalized_value === null, 'Row 3 Quantity correctly set to null (No shifting!)');
  assert(emptyRow.Price.normalized_value === 5000, 'Row 3 Price correctly retained as 5000 (No shifting!)');

  // --- Test 3: Numerical Analytics Calculation ---
  console.log('\n--- TEST 3: Numerical RAG Analytics Engine ---');
  const analytics = performNumericalTableAnalysis('What is the total price of all products?', prodTable);
  assert(analytics !== null, 'Analytics engine generated result');
  
  const priceStat = analytics.numericAnalytics.find(a => a.column === 'Price');
  assert(priceStat.sum === 45000, `Sum calculation correct (Expected 45000, got ${priceStat.sum})`);
  assert(priceStat.average === 15000, `Average calculation correct (Expected 15000, got ${priceStat.average})`);
  assert(priceStat.max === 25000, `Max calculation correct (Expected 25000, got ${priceStat.max})`);
  assert(priceStat.min === 5000, `Min calculation correct (Expected 5000, got ${priceStat.min})`);

  // --- Test 4: PDF Text Table Extraction ---
  console.log('\n--- TEST 4: PDF Text Layout Table Extraction ---');
  const samplePdfText = `INVOICE #1001
Date: 31/08/2026

Product       Quantity   Price
Ajwa Dates    100        ₹25,000
Medjool Dates    50         ₹15,000

Total Amount: ₹40,000`;

  const pdfTables = await extractTablesFromPdf(Buffer.from(''), 'invoice.pdf', samplePdfText);
  assert(pdfTables.length === 1, 'PDF text table extracted');
  assert(pdfTables[0].headers.join(',') === 'Product,Quantity,Price', 'PDF Table headers correct');
  assert(pdfTables[0].rows.length === 2, 'PDF Table rows count correct (2 rows)');
  assert(pdfTables[0].rows[0].Price.normalized_value === 25000, 'PDF Table Row 1 Price normalized to 25000');

  console.log('\n====================================================');
  console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================\n');
}

runTests().catch(err => console.error('Test execution error:', err));
