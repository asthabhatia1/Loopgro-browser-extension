/**
 * Google Apps Script — Loopgro Instagram CRM Backend
 *
 * ─── HOW TO DEPLOY ────────────────────────────────────────────────────────
 *  1. Open Google Sheets → Extensions → Apps Script
 *  2. Delete any existing code and paste this entire file
 *  3. Save (Ctrl+S)
 *  4. Click Deploy → New Deployment
 *  5. Type: Web App
 *  6. Execute as: Me
 *  7. Who has access: Anyone
 *  8. Click Deploy → copy the Web App URL
 *  9. Paste the URL into the Loopgro extension Settings tab
 *
 * ⚠️  Every time you modify this script you MUST create a NEW deployment
 *     (Deploy → Manage Deployments → New Version) for changes to take effect.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sheet column schema (A–G):
 *   A  Username
 *   B  Instagram Profile URL
 *   C  Acceptance
 *   D  Follower Count
 *   E  Post Count
 *   F  Comments
 *   G  Last Updated Date & Time
 */

// ─── Entry Points ──────────────────────────────────────────────────────────

/**
 * Handles all POST requests from the Chrome extension.
 * Actions: testConnection | getCreators | saveCreator | deleteCreator
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000); // wait up to 30s to prevent concurrent write conflicts
  } catch (err) {
    return jsonResponse({ success: false, error: 'Lock timeout — try again in a moment.' });
  }

  try {
    var req    = JSON.parse(e.postData.contents);
    var action = req.action;
    var sheetUrl = req.sheetUrl;

    if (!sheetUrl) {
      return jsonResponse({ success: false, error: 'Missing sheetUrl in request.' });
    }

    var ss    = SpreadsheetApp.openByUrl(sheetUrl);
    var sheet = ss.getSheets()[0];

    switch (action) {
      case 'testConnection':
        ensureHeaders(sheet);
        return jsonResponse({ success: true, message: 'Connection successful. Headers verified.' });

      case 'getCreators':
        return jsonResponse({ success: true, data: readCreators(sheet) });

      case 'saveCreator':
        return jsonResponse({ success: true, data: saveOrUpdate(sheet, req.data) });

      case 'deleteCreator':
        return jsonResponse({ success: true, data: deleteCreator(sheet, req.username) });

      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    }

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/** Simple GET health-check endpoint */
function doGet(e) {
  return ContentService.createTextOutput(
    'Loopgro Apps Script backend is running. Use HTTP POST from the extension.'
  );
}

// ─── JSON Helper ───────────────────────────────────────────────────────────

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Headers ───────────────────────────────────────────────────────────────

/**
 * Ensures the sheet has exactly the required 7 headers in columns A–G.
 * Clears any extra columns that may have existed from a previous schema.
 */
function ensureHeaders(sheet) {
  var HEADERS = [
    'Username',
    'Instagram Profile URL',
    'Acceptance',
    'Follower Count',
    'Post Count',
    'Comments',
    'Last Updated Date & Time'
  ];

  // Clear any extra columns from old schema (e.g. Display Name, Budget, etc.)
  var lastCol = sheet.getLastColumn();
  if (lastCol > 7) {
    sheet.getRange(1, 8, 1, lastCol - 7).clearContent();
  }

  // Write the correct headers
  var headerRange = sheet.getRange(1, 1, 1, 7);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ─── Read ──────────────────────────────────────────────────────────────────

/**
 * Reads all data rows and maps them to the canonical field names.
 * Returns an array of creator objects.
 */
function readCreators(sheet) {
  ensureHeaders(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // no data rows

  var data     = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var creators = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    // Skip completely empty rows
    if (!row[0] && !row[1]) continue;

    creators.push({
      username:      String(row[0] || '').trim(),
      profileUrl:    String(row[1] || '').trim(),
      acceptance:    String(row[2] || 'No').trim(),
      followerCount: toNumber(row[3]),
      postCount:     toNumber(row[4]),
      comments:      String(row[5] || '').trim(),
      lastUpdated:   row[6] ? new Date(row[6]).toISOString() : null
    });
  }

  return creators;
}

// ─── Save / Update ─────────────────────────────────────────────────────────

/**
 * Saves a creator. If a row with the same username already exists it is
 * updated in-place; otherwise a new row is appended.
 * Never creates duplicate usernames.
 *
 * Column order written to sheet:
 *   A  username
 *   B  profileUrl
 *   C  acceptance
 *   D  followerCount  (numeric)
 *   E  postCount      (numeric)
 *   F  comments
 *   G  new Date()     (timestamp)
 */
function saveOrUpdate(sheet, creator) {
  ensureHeaders(sheet);

  if (!creator || !creator.username) {
    throw new Error('creator.username is required');
  }

  var username    = String(creator.username).trim().toLowerCase();
  var lastRow     = sheet.getLastRow();
  var existingRow = -1;

  // Search column A for a matching username (case-insensitive)
  if (lastRow >= 2) {
    var usernames = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < usernames.length; i++) {
      if (String(usernames[i][0]).trim().toLowerCase() === username) {
        existingRow = i + 2; // 1-indexed; row 1 = header
        break;
      }
    }
  }

  // Build the row in the exact required column order
  var rowValues = [
    creator.username,
    creator.profileUrl  || '',
    creator.acceptance  || '',
    toNumber(creator.followerCount),
    toNumber(creator.postCount),
    creator.comments    || '',
    new Date()
  ];

  if (existingRow > -1) {
    // Clear any trailing columns from old schema before overwriting
    var currentLastCol = sheet.getLastColumn();
    if (currentLastCol > 7) {
      sheet.getRange(existingRow, 8, 1, currentLastCol - 7).clearContent();
    }
    sheet.getRange(existingRow, 1, 1, 7).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return readCreators(sheet);
}

// ─── Delete ────────────────────────────────────────────────────────────────

/**
 * Finds and deletes the row whose username (column A) matches the given value.
 */
function deleteCreator(sheet, username) {
  if (!username) throw new Error('username is required for deleteCreator');

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var target   = String(username).trim().toLowerCase();
  var usernames = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var i = 0; i < usernames.length; i++) {
    if (String(usernames[i][0]).trim().toLowerCase() === target) {
      sheet.deleteRow(i + 2);
      break;
    }
  }

  return readCreators(sheet);
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Safely converts a value to a number.
 * Strips commas and K/M/B suffixes (from user-edited fields).
 * Returns 0 if conversion is not possible.
 */
function toNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val);

  var str = String(val).trim().replace(/,/g, '');
  var multipliers = { k: 1e3, m: 1e6, b: 1e9 };
  var match = str.match(/^([\d.]+)([KMBkmb])?$/i);
  if (!match) return 0;

  var num    = parseFloat(match[1]);
  var suffix = (match[2] || '').toLowerCase();
  return suffix ? Math.round(num * (multipliers[suffix] || 1)) : Math.round(num);
}
