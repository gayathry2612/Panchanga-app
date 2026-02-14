// =============================================================================
// Prokerala Panchanga Generator — Google Apps Script
// =============================================================================
//
// SETUP INSTRUCTIONS:
// 1. Open your Google Sheet
// 2. Extensions > Apps Script > paste this code
// 3. Reload the sheet — the "🪐 Panchanga" menu will appear
// 4. Panchanga > Set API Credentials  (enter CLIENT_ID and CLIENT_SECRET)
// 5. Panchanga > Setup Config Sheet   (creates Config tab with sample rows)
// 6. Edit the Config tab with your locations
// 7. Panchanga > Generate Panchanga Report
//
// LOOKER STUDIO: Connect each sheet below as a separate data source:
//   • Panchanga_Summary      — one row per location/date (sunrise, sunset, vaara)
//   • Panchanga_Nakshatra    — one row per nakshatra period
//   • Panchanga_Tithi        — one row per tithi period
//   • Panchanga_Karana       — one row per karana period
//   • Panchanga_Yoga         — one row per yoga period
//   • Panchanga_Auspicious   — one row per auspicious period slot
//   • Panchanga_Inauspicious — one row per inauspicious period slot
// =============================================================================

// --------------------------------------------------------------------------
// Config tab column positions (1-indexed)
// --------------------------------------------------------------------------
const COL_LOCATION_NAME = 1;  // A — Human-readable label (e.g. "Mumbai")
const COL_LATITUDE      = 2;  // B — e.g. 19.0821978
const COL_LONGITUDE     = 3;  // C — e.g. 72.7411014
const COL_TIMEZONE      = 4;  // D — e.g. Asia/Kolkata
const COL_START_DATE    = 5;  // E — Start date e.g. 2026-01-01
const COL_END_DATE      = 6;  // F — End date   e.g. 2026-01-31 (leave blank = same as start)
const COL_AYANAMSA      = 7;  // G — 1 = Lahiri (default), 0 = Tropical
const COL_LANGUAGE      = 8;  // H — en / hi / ta / te / ml  (default: en)

// Output sheet names
const SHEET_SUMMARY      = 'Panchanga_Summary';
const SHEET_NAKSHATRA    = 'Panchanga_Nakshatra';
const SHEET_TITHI        = 'Panchanga_Tithi';
const SHEET_KARANA       = 'Panchanga_Karana';
const SHEET_YOGA         = 'Panchanga_Yoga';
const SHEET_AUSPICIOUS   = 'Panchanga_Auspicious';
const SHEET_INAUSPICIOUS = 'Panchanga_Inauspicious';

// Sheet header definitions
const SHEET_HEADERS = {
  [SHEET_SUMMARY]: [
    'Generated At', 'Location', 'Date', 'Latitude', 'Longitude',
    'Timezone', 'Ayanamsa', 'Language',
    'Sunrise', 'Sunset', 'Moonrise', 'Moonset', 'Vaara',
  ],
  [SHEET_NAKSHATRA]: [
    'Generated At', 'Location', 'Date',
    'Nakshatra ID', 'Nakshatra Name',
    'Lord ID', 'Lord Name', 'Lord Vedic Name',
    'Start', 'End', 'Start Time', 'End Time',
  ],
  [SHEET_TITHI]: [
    'Generated At', 'Location', 'Date',
    'Tithi ID', 'Tithi Name', 'Paksha',
    'Start', 'End', 'Start Time', 'End Time',
  ],
  [SHEET_KARANA]: [
    'Generated At', 'Location', 'Date',
    'Karana ID', 'Karana Name',
    'Start', 'End', 'Start Time', 'End Time',
  ],
  [SHEET_YOGA]: [
    'Generated At', 'Location', 'Date',
    'Yoga ID', 'Yoga Name',
    'Start', 'End', 'Start Time', 'End Time',
  ],
  [SHEET_AUSPICIOUS]: [
    'Generated At', 'Location', 'Date',
    'Period ID', 'Period Name', 'Type',
    'Start', 'End', 'Start Time', 'End Time',
  ],
  [SHEET_INAUSPICIOUS]: [
    'Generated At', 'Location', 'Date',
    'Period ID', 'Period Name', 'Type',
    'Start', 'End', 'Start Time', 'End Time',
  ],
};

// Header background colors per sheet
const HEADER_COLORS = {
  [SHEET_SUMMARY]:      '#4a154b',
  [SHEET_NAKSHATRA]:    '#1a5276',
  [SHEET_TITHI]:        '#145a32',
  [SHEET_KARANA]:       '#7d6608',
  [SHEET_YOGA]:         '#6e2f1a',
  [SHEET_AUSPICIOUS]:   '#1e8449',
  [SHEET_INAUSPICIOUS]: '#922b21',
};

// API endpoints
const TOKEN_URL    = 'https://api.prokerala.com/token';
const PANCHANG_URL = 'https://api.prokerala.com/v2/astrology/panchang/advanced';

// =============================================================================
// Menu
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🪐 Panchanga')
    .addItem('▶ Generate Panchanga Report', 'generatePanchangaReport')
    .addSeparator()
    .addItem('⚙ Set API Credentials',  'setCredentials')
    .addItem('📋 Setup Config Sheet',   'setupConfigSheet')
    .addItem('🗑 Clear All Output Sheets', 'clearAllOutputSheets')
    .addToUi();
}

// =============================================================================
// Credential Setup (stored in Script Properties — never in the sheet)
// =============================================================================

function setCredentials() {
  const ui = SpreadsheetApp.getUi();

  const idRes = ui.prompt('API Credentials', 'Enter your Prokerala CLIENT_ID:', ui.ButtonSet.OK_CANCEL);
  if (idRes.getSelectedButton() !== ui.Button.OK) return;

  const secRes = ui.prompt('API Credentials', 'Enter your Prokerala CLIENT_SECRET:', ui.ButtonSet.OK_CANCEL);
  if (secRes.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    CLIENT_ID:     idRes.getResponseText().trim(),
    CLIENT_SECRET: secRes.getResponseText().trim(),
  });

  ui.alert('✅ Credentials saved securely in Script Properties.');
}

// =============================================================================
// Token Fetch (cached 55 min)
// =============================================================================

function getAccessToken() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('prokerala_token');
  if (cached) return cached;

  const props  = PropertiesService.getScriptProperties();
  const id     = props.getProperty('CLIENT_ID');
  const secret = props.getProperty('CLIENT_SECRET');

  if (!id || !secret) {
    throw new Error('Credentials not set. Use Panchanga > Set API Credentials first.');
  }

  const res  = UrlFetchApp.fetch(TOKEN_URL, {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: id, client_secret: secret },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());

  if (!data.access_token) {
    throw new Error('Token fetch failed: ' + res.getContentText());
  }

  cache.put('prokerala_token', data.access_token, 55 * 60);
  return data.access_token;
}

// =============================================================================
// Fetch Panchanga from API
// =============================================================================

function fetchPanchanga(token, lat, lng, datetime, ayanamsa, lang) {
  const qs = [
    'ayanamsa='    + encodeURIComponent(ayanamsa),
    'coordinates=' + encodeURIComponent(lat + ',' + lng),
    'datetime='    + encodeURIComponent(datetime),
    'la='          + encodeURIComponent(lang),
  ].join('&');

  const res = UrlFetchApp.fetch(PANCHANG_URL + '?' + qs, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('HTTP ' + res.getResponseCode() + ': ' + res.getContentText());
  }

  return JSON.parse(res.getContentText());
}

// =============================================================================
// Helpers
// =============================================================================

function isoToDate(isoString) {
  // Returns a JS Date object for Google Sheets date cells
  if (!isoString) return '';
  try { return new Date(isoString); } catch (e) { return isoString; }
}

function isoToTimeStr(isoString, timezone) {
  // Returns "hh:mm a" in the location's local timezone (not the script's timezone)
  if (!isoString) return '';
  try {
    const tz = timezone || 'Asia/Kolkata';
    return Utilities.formatDate(new Date(isoString), tz, 'hh:mm a');
  } catch (e) { return isoString; }
}

function buildDatetime(dateVal, timezone) {
  const tz = timezone || 'Asia/Kolkata';
  let base;
  if (dateVal instanceof Date && !isNaN(dateVal)) {
    base = dateVal;
  } else if (String(dateVal).trim()) {
    base = new Date(String(dateVal).trim() + 'T06:00:00');
  } else {
    base = new Date();
  }
  return Utilities.formatDate(base, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// Returns array of Date objects for each day between startDate and endDate (inclusive)
function getDatesInRange(startVal, endVal, timezone) {
  const tz = timezone || 'Asia/Kolkata';

  const toDate = function(val) {
    if (val instanceof Date && !isNaN(val)) return val;
    const s = String(val).trim();
    return s ? new Date(s + 'T06:00:00') : new Date();
  };

  const start = toDate(startVal);
  const end   = endVal && String(endVal).trim() ? toDate(endVal) : start;

  const dates = [];
  const cur = new Date(start);
  cur.setHours(6, 0, 0, 0);
  end.setHours(6, 0, 0, 0);

  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeaders(sheet, sheetName) {
  if (sheet.getLastRow() > 0) return;
  const headers = SHEET_HEADERS[sheetName];
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground(HEADER_COLORS[sheetName])
    .setFontColor('#ffffff')
    .setFontWeight('bold');
}

function batchWrite(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// =============================================================================
// JSON → Row parsers
// =============================================================================

function parseSummaryRow(generatedAt, location, dateStr, lat, lng, timezone, ayanamsa, lang, d) {
  return [
    generatedAt,
    location,
    dateStr,
    lat,
    lng,
    timezone,
    ayanamsa,
    lang,
    isoToTimeStr(d.sunrise,  timezone),
    isoToTimeStr(d.sunset,   timezone),
    isoToTimeStr(d.moonrise, timezone),
    isoToTimeStr(d.moonset,  timezone),
    d.vaara || '',
  ];
}

function parseNakshatraRows(generatedAt, location, dateStr, nakshatra, timezone) {
  return (nakshatra || []).map(function(n) {
    return [
      generatedAt,
      location,
      dateStr,
      n.id   || '',
      n.name || '',
      n.lord ? n.lord.id         : '',
      n.lord ? n.lord.name       : '',
      n.lord ? n.lord.vedic_name : '',
      isoToDate(n.start),
      isoToDate(n.end),
      isoToTimeStr(n.start, timezone),
      isoToTimeStr(n.end,   timezone),
    ];
  });
}

function parseTithiRows(generatedAt, location, dateStr, tithi, timezone) {
  return (tithi || []).map(function(t) {
    return [
      generatedAt,
      location,
      dateStr,
      t.id     || '',
      t.name   || '',
      t.paksha || '',
      isoToDate(t.start),
      isoToDate(t.end),
      isoToTimeStr(t.start, timezone),
      isoToTimeStr(t.end,   timezone),
    ];
  });
}

function parseKaranaRows(generatedAt, location, dateStr, karana, timezone) {
  return (karana || []).map(function(k) {
    return [
      generatedAt,
      location,
      dateStr,
      k.id   || '',
      k.name || '',
      isoToDate(k.start),
      isoToDate(k.end),
      isoToTimeStr(k.start, timezone),
      isoToTimeStr(k.end,   timezone),
    ];
  });
}

function parseYogaRows(generatedAt, location, dateStr, yoga, timezone) {
  return (yoga || []).map(function(y) {
    return [
      generatedAt,
      location,
      dateStr,
      y.id   || '',
      y.name || '',
      isoToDate(y.start),
      isoToDate(y.end),
      isoToTimeStr(y.start, timezone),
      isoToTimeStr(y.end,   timezone),
    ];
  });
}

// Flattens auspicious_period / inauspicious_period — one row per slot
// e.g. Dur Muhurat has 2 period slots → 2 rows
function parseMuhurtaRows(generatedAt, location, dateStr, periods, timezone) {
  const rows = [];
  (periods || []).forEach(function(p) {
    (p.period || []).forEach(function(slot) {
      rows.push([
        generatedAt,
        location,
        dateStr,
        p.id   || '',
        p.name || '',
        p.type || '',
        isoToDate(slot.start),
        isoToDate(slot.end),
        isoToTimeStr(slot.start, timezone),
        isoToTimeStr(slot.end,   timezone),
      ]);
    });
  });
  return rows;
}

// =============================================================================
// Main: Generate Report
// =============================================================================

function generatePanchangaReport() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('Config');

  if (!configSheet) {
    SpreadsheetApp.getUi().alert('Sheet "Config" not found.\nRun Panchanga > Setup Config Sheet first.');
    return;
  }

  const lastRow = configSheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No location rows found in Config sheet.');
    return;
  }

  // Read config rows (skip header)
  const configData = configSheet.getRange(2, 1, lastRow - 1, COL_LANGUAGE).getValues();

  // Get or create all output sheets
  const sheets = {
    summary:      getOrCreateSheet(ss, SHEET_SUMMARY),
    nakshatra:    getOrCreateSheet(ss, SHEET_NAKSHATRA),
    tithi:        getOrCreateSheet(ss, SHEET_TITHI),
    karana:       getOrCreateSheet(ss, SHEET_KARANA),
    yoga:         getOrCreateSheet(ss, SHEET_YOGA),
    auspicious:   getOrCreateSheet(ss, SHEET_AUSPICIOUS),
    inauspicious: getOrCreateSheet(ss, SHEET_INAUSPICIOUS),
  };

  // Ensure headers on empty sheets
  ensureHeaders(sheets.summary,      SHEET_SUMMARY);
  ensureHeaders(sheets.nakshatra,    SHEET_NAKSHATRA);
  ensureHeaders(sheets.tithi,        SHEET_TITHI);
  ensureHeaders(sheets.karana,       SHEET_KARANA);
  ensureHeaders(sheets.yoga,         SHEET_YOGA);
  ensureHeaders(sheets.auspicious,   SHEET_AUSPICIOUS);
  ensureHeaders(sheets.inauspicious, SHEET_INAUSPICIOUS);

  // Fetch token
  let token;
  try {
    token = getAccessToken();
  } catch (e) {
    SpreadsheetApp.getUi().alert('Auth Error: ' + e.message);
    return;
  }

  const generatedAt  = new Date();
  const errors       = [];

  // Accumulators for batch write
  const summaryRows      = [];
  const nakshatraRows    = [];
  const tithiRows        = [];
  const karanaRows       = [];
  const yogaRows         = [];
  const auspiciousRows   = [];
  const inauspiciousRows = [];

  // Rate limit: API allows 5 req/min (= 1 req per 12s) — sleep 13s after every request
  let requestCount = 0;

  configData.forEach(function(row, idx) {
    const location  = row[COL_LOCATION_NAME - 1];
    const lat       = row[COL_LATITUDE - 1];
    const lng       = row[COL_LONGITUDE - 1];
    const timezone  = row[COL_TIMEZONE - 1]   || 'Asia/Kolkata';
    const startVal  = row[COL_START_DATE - 1];
    const endVal    = row[COL_END_DATE - 1];
    const ayanamsa  = row[COL_AYANAMSA - 1]   || 1;
    const lang      = row[COL_LANGUAGE - 1]   || 'en';

    if (!location || !lat || !lng) return; // skip blank rows

    const dates = getDatesInRange(startVal, endVal, timezone);

    dates.forEach(function(dateObj) {
      const dateStr  = Utilities.formatDate(dateObj, timezone, 'yyyy-MM-dd');
      const datetime = buildDatetime(dateObj, timezone);

      try {
        const response = fetchPanchanga(token, lat, lng, datetime, ayanamsa, lang);
        requestCount++;
        const d = response.data; // fields directly under data (no .result wrapper)

        summaryRows.push(
          parseSummaryRow(generatedAt, location, dateStr, lat, lng, timezone, ayanamsa, lang, d)
        );
        nakshatraRows.push(   ...parseNakshatraRows(generatedAt, location, dateStr, d.nakshatra,          timezone));
        tithiRows.push(       ...parseTithiRows(    generatedAt, location, dateStr, d.tithi,              timezone));
        karanaRows.push(      ...parseKaranaRows(   generatedAt, location, dateStr, d.karana,             timezone));
        yogaRows.push(        ...parseYogaRows(     generatedAt, location, dateStr, d.yoga,               timezone));
        auspiciousRows.push(  ...parseMuhurtaRows(  generatedAt, location, dateStr, d.auspicious_period,   timezone));
        inauspiciousRows.push(...parseMuhurtaRows(  generatedAt, location, dateStr, d.inauspicious_period, timezone));

      } catch (e) {
        requestCount++;
        errors.push(location + ' ' + dateStr + ': ' + e.message);
      }

      // Always sleep 13s after each request to stay under 5 req/min
      Utilities.sleep(13000);
    });
  });

  // Batch write all sheets
  batchWrite(sheets.summary,      summaryRows);
  batchWrite(sheets.nakshatra,    nakshatraRows);
  batchWrite(sheets.tithi,        tithiRows);
  batchWrite(sheets.karana,       karanaRows);
  batchWrite(sheets.yoga,         yogaRows);
  batchWrite(sheets.auspicious,   auspiciousRows);
  batchWrite(sheets.inauspicious, inauspiciousRows);

  // Auto-resize all sheets
  Object.values(sheets).forEach(function(s) {
    const cols = s.getLastColumn();
    if (cols > 0) s.autoResizeColumns(1, cols);
  });

  let msg = '✅ Done! (' + requestCount + ' API calls)\n'
    + '  Summary rows      : ' + summaryRows.length      + '\n'
    + '  Nakshatra rows    : ' + nakshatraRows.length     + '\n'
    + '  Tithi rows        : ' + tithiRows.length         + '\n'
    + '  Karana rows       : ' + karanaRows.length        + '\n'
    + '  Yoga rows         : ' + yogaRows.length          + '\n'
    + '  Auspicious rows   : ' + auspiciousRows.length    + '\n'
    + '  Inauspicious rows : ' + inauspiciousRows.length;

  if (errors.length) {
    msg += '\n\n⚠️ Errors:\n' + errors.join('\n');
  }

  SpreadsheetApp.getUi().alert(msg);
}

// =============================================================================
// Utility: Clear all output sheets (keep headers)
// =============================================================================

function clearAllOutputSheets() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const names = [SHEET_SUMMARY, SHEET_NAKSHATRA, SHEET_TITHI, SHEET_KARANA, SHEET_YOGA, SHEET_AUSPICIOUS, SHEET_INAUSPICIOUS];

  names.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  });

  SpreadsheetApp.getUi().alert('All output sheets cleared (headers kept).');
}

// =============================================================================
// Utility: Create Config sheet with sample locations
// =============================================================================

function setupConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Config');
  if (!sheet) sheet = ss.insertSheet('Config');

  sheet.clearContents();

  sheet.getRange(1, 1, 1, 8).setValues([[
    'Location Name', 'Latitude', 'Longitude', 'Timezone',
    'Start Date (yyyy-MM-dd)', 'End Date (yyyy-MM-dd)', 'Ayanamsa', 'Language',
  ]]);
  sheet.getRange(1, 1, 1, 8)
    .setBackground('#1a73e8')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  sheet.getRange(2, 1, 5, 8).setValues([
    ['Mumbai',    19.0821978,  72.7411014, 'Asia/Kolkata', '2026-01-01', '2026-01-31', 1, 'en'],
    ['Delhi',     28.6139391,  77.2090212, 'Asia/Kolkata', '2026-01-01', '2026-01-31', 1, 'en'],
    ['Chennai',   13.0826802,  80.2707184, 'Asia/Kolkata', '2026-01-01', '2026-01-31', 1, 'ta'],
    ['Bangalore', 12.9715987,  77.5945627, 'Asia/Kolkata', '2026-01-01', '2026-01-31', 1, 'en'],
    ['Kochi',     10.0167,     76.2667,    'Asia/Kolkata', '2026-01-01', '2026-01-31', 1, 'ml'],
  ]);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 8);

  SpreadsheetApp.getUi().alert('✅ Config sheet created with 5 sample locations.\nDate range set to Jan 2026. Edit rows and run Generate Panchanga Report.');
}
