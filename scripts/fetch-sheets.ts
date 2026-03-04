import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const SPREADSHEET_ID = '15wiNF1pTAUzohfu4mTglFeM1rgfL62C5-8nrp5u3CcQ';

interface SheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

interface SheetData {
  sheetId: number;
  title: string;
  rows: string[][];
}

interface SheetsCache {
  lastFetched: string;
  spreadsheetId: string;
  tabs: SheetTab[];
  data: SheetData[];
}

function getApiKey(): string {
  const envPath = join(import.meta.dirname, '..', '.env');
  if (!existsSync(envPath)) {
    throw new Error('.env file not found. Create it with YOUTUBE_API_KEY=...');
  }
  const envContent = readFileSync(envPath, 'utf-8');
  const match = envContent.match(/YOUTUBE_API_KEY=(.+)/);
  if (!match) {
    throw new Error('YOUTUBE_API_KEY not found in .env (same key works for Sheets API)');
  }
  return match[1].trim();
}

async function discoverTabs(apiKey: string): Promise<SheetTab[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Sheets API error: ${data.error.message}`);
  }

  return (data.sheets ?? []).map((s: any) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    rowCount: s.properties.gridProperties?.rowCount ?? 0,
    columnCount: s.properties.gridProperties?.columnCount ?? 0,
  }));
}

async function fetchSheetData(apiKey: string, sheetTitle: string): Promise<string[][]> {
  const encodedTitle = encodeURIComponent(sheetTitle);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedTitle}?key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    console.error(`  Error fetching "${sheetTitle}": ${data.error.message}`);
    return [];
  }

  return data.values ?? [];
}

function isRelevantTab(title: string): boolean {
  const lower = title.toLowerCase();
  const keywords = ['combo', 'ranking', 'blade', 'ratchet', 'bit', 'tier', 'score', 'part', 'assist'];
  return keywords.some((kw) => lower.includes(kw));
}

async function main() {
  console.log('Google Sheets fetcher for Beyblade X Tier List');
  console.log('===============================================\n');

  const apiKey = getApiKey();

  console.log('Discovering sheet tabs...');
  const tabs = await discoverTabs(apiKey);

  console.log(`Found ${tabs.length} tabs:`);
  for (const tab of tabs) {
    const relevant = isRelevantTab(tab.title);
    console.log(`  ${relevant ? '[RELEVANT]' : '[skip]    '} "${tab.title}" (${tab.rowCount} rows × ${tab.columnCount} cols)`);
  }

  const relevantTabs = tabs.filter((t) => isRelevantTab(t.title));

  if (relevantTabs.length === 0) {
    console.log('\nNo relevant tabs found. Fetching ALL tabs with data...');
    const dataTabs = tabs.filter((t) => t.rowCount > 1);
    relevantTabs.push(...dataTabs);
  }

  console.log(`\nFetching data from ${relevantTabs.length} tabs...\n`);

  const sheetData: SheetData[] = [];

  for (const tab of relevantTabs) {
    console.log(`  Fetching: "${tab.title}"`);
    const rows = await fetchSheetData(apiKey, tab.title);
    if (rows.length > 0) {
      sheetData.push({
        sheetId: tab.sheetId,
        title: tab.title,
        rows,
      });
      console.log(`    → ${rows.length} rows fetched`);
    }
  }

  const cache: SheetsCache = {
    lastFetched: new Date().toISOString().slice(0, 10),
    spreadsheetId: SPREADSHEET_ID,
    tabs,
    data: sheetData,
  };

  const outPath = join(DATA_DIR, 'sheets-cache.json');
  writeFileSync(outPath, JSON.stringify(cache, null, 2));
  console.log(`\nSaved to ${outPath}`);

  const scanHistoryPath = join(DATA_DIR, 'scan-history.json');
  const scanHistory = JSON.parse(readFileSync(scanHistoryPath, 'utf-8'));
  scanHistory.scannedSheets[SPREADSHEET_ID] = {
    lastScannedDate: new Date().toISOString().slice(0, 10),
    totalRows: sheetData.reduce((sum, s) => sum + s.rows.length, 0),
    tabCount: sheetData.length,
  };
  writeFileSync(scanHistoryPath, JSON.stringify(scanHistory, null, 2));
}

main().catch(console.error);
