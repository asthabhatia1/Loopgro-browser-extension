/**
 * dashboard/dashboard.js
 *
 * CRM Dashboard controller.
 * Column schema (matches Google Sheet exactly):
 *   A → username
 *   B → profileUrl
 *   C → acceptance
 *   D → followerCount
 *   E → postCount
 *   F → comments
 *   G → lastUpdated (Date object / ISO string)
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Loopgro] Dashboard initialized.');

  // ── State ────────────────────────────────────────────────────────────────
  let creators      = [];
  let googleSheetUrl = '';
  let appsScriptUrl  = '';

  // ── DOM References ───────────────────────────────────────────────────────
  const tabBtnDatabase      = document.getElementById('tabBtnDatabase');
  const tabBtnSettings      = document.getElementById('tabBtnSettings');
  const tabContentDatabase  = document.getElementById('tabContentDatabase');
  const tabContentSettings  = document.getElementById('tabContentSettings');
  const storageModeBadge    = document.getElementById('storageModeBadge');

  const totalSavedMetric      = document.getElementById('totalSavedMetric');
  const acceptedMetric        = document.getElementById('acceptedMetric');
  const acceptanceRateMetric  = document.getElementById('acceptanceRateMetric');

  const searchInput   = document.getElementById('searchInput');
  const tableBody     = document.getElementById('tableBody');
  const emptyState    = document.getElementById('emptyState');
  const syncSheetBtn  = document.getElementById('syncSheetBtn');

  const googleSheetUrlInput = document.getElementById('googleSheetUrlInput');
  const appsScriptUrlInput  = document.getElementById('appsScriptUrlInput');
  const saveSettingsBtn     = document.getElementById('saveSettingsBtn');
  const testConnectionBtn   = document.getElementById('testConnectionBtn');
  const statusPanel         = document.getElementById('statusPanel');
  const statusPanelText     = document.getElementById('statusPanelText');
  const statusPanelIcon     = document.getElementById('statusPanelIcon');

  // ── Tab Navigation ───────────────────────────────────────────────────────

  function switchTab(tabId) {
    const isDatabase = tabId === 'database';
    tabBtnDatabase.classList.toggle('active', isDatabase);
    tabBtnSettings.classList.toggle('active', !isDatabase);
    tabContentDatabase.classList.toggle('hidden', !isDatabase);
    tabContentSettings.classList.toggle('hidden', isDatabase);
    if (isDatabase) loadDatabase();
  }

  tabBtnDatabase.addEventListener('click', () => switchTab('database'));
  tabBtnSettings.addEventListener('click', () => switchTab('settings'));
  if (window.location.hash === '#settings') switchTab('settings');

  // ── Settings ─────────────────────────────────────────────────────────────

  function loadSettings(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      googleSheetUrl = localStorage.getItem('googleSheetUrl') || '';
      appsScriptUrl  = localStorage.getItem('appsScriptUrl')  || '';
      googleSheetUrlInput.value = googleSheetUrl;
      appsScriptUrlInput.value  = appsScriptUrl;
      if (callback) callback();
      return;
    }
    chrome.storage.local.get(['googleSheetUrl', 'appsScriptUrl'], (result) => {
      googleSheetUrl = result.googleSheetUrl || '';
      appsScriptUrl  = result.appsScriptUrl  || '';
      googleSheetUrlInput.value = googleSheetUrl;
      appsScriptUrlInput.value  = appsScriptUrl;
      if (callback) callback();
    });
  }

  function isValidGoogleSheetUrl(url) {
    return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/.test(url.trim());
  }

  function isValidAppsScriptUrl(url) {
    return /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9-_]+\/exec/.test(url.trim());
  }

  function updateStatusPanel(message, type) {
    statusPanel.className = `status-panel ${type}`;
    statusPanel.classList.remove('hidden');
    statusPanelText.textContent = message;

    const icons = {
      loading: '<img src="../assets/loading.svg" class="status-img" alt="Loading">',
      success: '<img src="../assets/success-mascot.svg" class="status-img" alt="Success">',
      danger:  '<img src="../assets/error-mascot.svg" class="status-img" alt="Error">',
    };
    statusPanelIcon.innerHTML = icons[type] || '';
  }

  saveSettingsBtn.addEventListener('click', () => {
    const sheetVal  = googleSheetUrlInput.value.trim();
    const scriptVal = appsScriptUrlInput.value.trim();

    if (sheetVal && !isValidGoogleSheetUrl(sheetVal)) {
      alert('Invalid Google Sheets URL. Expected: https://docs.google.com/spreadsheets/d/…');
      return;
    }
    if (scriptVal && !isValidAppsScriptUrl(scriptVal)) {
      alert('Invalid Apps Script URL. Expected: https://script.google.com/macros/s/…/exec');
      return;
    }

    googleSheetUrl = sheetVal;
    appsScriptUrl  = scriptVal;

    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      localStorage.setItem('googleSheetUrl', googleSheetUrl);
      localStorage.setItem('appsScriptUrl',  appsScriptUrl);
      alert('Settings saved (LocalStorage).');
      return;
    }

    chrome.storage.local.set({ googleSheetUrl, appsScriptUrl }, () => {
      alert('Settings saved! Future connections will use these URLs.');
    });
  });

  testConnectionBtn.addEventListener('click', () => {
    const sheetVal  = googleSheetUrlInput.value.trim();
    const scriptVal = appsScriptUrlInput.value.trim();

    if (!sheetVal || !scriptVal) {
      updateStatusPanel('Please provide both URLs before testing.', 'danger');
      return;
    }
    if (!isValidGoogleSheetUrl(sheetVal) || !isValidAppsScriptUrl(scriptVal)) {
      updateStatusPanel('One or both URLs have invalid format. Check entries.', 'danger');
      return;
    }

    updateStatusPanel('Testing connection to Apps Script…', 'loading');

    fetch(scriptVal, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'testConnection', sheetUrl: sheetVal }),
    })
      .then(r => r.json())
      .then(data => {
        if (data?.success) {
          updateStatusPanel('Connected! Headers written to your Google Sheet.', 'success');
        } else {
          updateStatusPanel('Connection failed: ' + (data.error || 'Unknown error'), 'danger');
        }
      })
      .catch(err => {
        updateStatusPanel('Network error: ' + err.message, 'danger');
      });
  });

  // ── Data Loading ──────────────────────────────────────────────────────────

  function loadDatabase() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      // Local dev fallback
      storageModeBadge.textContent        = 'LocalStorage (Offline)';
      storageModeBadge.style.backgroundColor = '#fffbeb';
      storageModeBadge.style.color           = '#d97706';
      storageModeBadge.style.borderColor     = '#fef3c7';

      let stored = [];
      try {
        const raw = localStorage.getItem('savedCreators');
        stored = raw ? JSON.parse(raw) : getMockData();
        if (!raw) localStorage.setItem('savedCreators', JSON.stringify(stored));
      } catch (e) {
        console.error('[Loopgro] Local read error:', e);
      }
      creators = stored;
      renderDashboard();
      return;
    }

    chrome.storage.local.get(['googleSheetUrl', 'appsScriptUrl'], (result) => {
      googleSheetUrl = result.googleSheetUrl || '';
      appsScriptUrl  = result.appsScriptUrl  || '';

      if (!googleSheetUrl || !appsScriptUrl) {
        setBadge('Not Configured', '#fef2f2', '#ef4444', '#fee2e2');
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="table-loading-cell">
              ⚠️ Google Sheets not configured.
              <a href="#" id="inlineSettingsRedirect" style="color:var(--accent-indigo);font-weight:600;">Go to Settings</a>
            </td>
          </tr>`;
        document.getElementById('inlineSettingsRedirect')?.addEventListener('click', (e) => {
          e.preventDefault();
          switchTab('settings');
        });
        creators = [];
        calculateMetrics();
        return;
      }

      setBadge('Synced (Google Sheets)', '', '', '');
      fetchCreatorsFromSheet();
    });
  }

  function setBadge(text, bg, color, border) {
    storageModeBadge.textContent        = text;
    storageModeBadge.style.backgroundColor = bg;
    storageModeBadge.style.color           = color;
    storageModeBadge.style.borderColor     = border;
  }

  function fetchCreatorsFromSheet() {
    tableBody.innerHTML = `<tr><td colspan="8" class="table-loading-cell">Fetching rows from Google Sheet…</td></tr>`;

    fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getCreators', sheetUrl: googleSheetUrl }),
    })
      .then(r => r.json())
      .then(res => {
        if (res?.success) {
          creators = res.data || [];
          renderDashboard();
        } else {
          tableBody.innerHTML = errorCell(`Failed to fetch: ${res.error || 'Unknown error'}`);
        }
      })
      .catch(err => {
        tableBody.innerHTML = errorCell(`Network error: ${err.message}`);
      });
  }

  function errorCell(msg) {
    return `<tr><td colspan="8" class="table-loading-cell" style="color:var(--color-danger);">⚠️ ${msg}</td></tr>`;
  }

  syncSheetBtn.addEventListener('click', loadDatabase);

  // ── Metrics ───────────────────────────────────────────────────────────────

  function calculateMetrics() {
    const total    = creators.length;
    const accepted = creators.filter(c => c.acceptance === 'Yes').length;
    const rate     = total > 0 ? Math.round((accepted / total) * 100) : 0;

    if (totalSavedMetric)     totalSavedMetric.textContent     = total;
    if (acceptedMetric)       acceptedMetric.textContent       = accepted;
    if (acceptanceRateMetric) acceptanceRateMetric.textContent = `${rate}%`;
  }

  // ── Table Rendering ───────────────────────────────────────────────────────

  function renderDashboard() {
    calculateMetrics();
    filterAndDrawRows();
  }

  function filterAndDrawRows() {
    const q = searchInput.value.trim().toLowerCase();

    const filtered = creators.filter(c =>
      (c.username     || '').toLowerCase().includes(q) ||
      (c.profileUrl   || '').toLowerCase().includes(q) ||
      (c.comments     || '').toLowerCase().includes(q) ||
      (c.acceptance   || '').toLowerCase().includes(q) ||
      String(c.followerCount || '').toLowerCase().includes(q) ||
      String(c.postCount     || '').toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      tableBody.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    tableBody.innerHTML = filtered.map((c) => {
      const origIndex = creators.findIndex(o => o.username === c.username);

      // Format the last-updated date
      const rawDate = c.lastUpdated || c.savedAt;
      const formattedDate = rawDate
        ? new Date(rawDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : '—';

      const acceptClass = c.acceptance === 'Yes' ? 'badge-status-sent' : 'badge-status-unsent';
      const profileUrl  = c.profileUrl || '';
      const safeUrl     = profileUrl.replace(/"/g, '&quot;');

      return `
        <tr data-index="${origIndex}">
          <td>
            <input type="text" class="cell-input font-semibold" value="${escHtml(c.username)}" data-field="username">
          </td>

          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="text" class="cell-input" value="${escHtml(profileUrl)}" data-field="profileUrl">
              <a href="${safeUrl}" target="_blank" class="profile-link" title="Open Instagram Profile">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                     stroke="currentColor" style="width:14px;height:14px;color:var(--text-secondary);">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018
                           18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
                </svg>
              </a>
            </div>
          </td>

          <td>
            <select class="cell-select ${acceptClass}" data-field="acceptance">
              <option value="No"  ${c.acceptance !== 'Yes' ? 'selected' : ''}>No</option>
              <option value="Yes" ${c.acceptance === 'Yes' ? 'selected' : ''}>Yes</option>
            </select>
          </td>

          <td>
            <input type="text" class="cell-input" value="${escHtml(String(c.followerCount ?? ''))}" data-field="followerCount">
          </td>

          <td>
            <input type="text" class="cell-input" value="${escHtml(String(c.postCount ?? ''))}" data-field="postCount">
          </td>

          <td>
            <input type="text" class="cell-input" value="${escHtml(c.comments || '')}" placeholder="Add notes…" data-field="comments">
          </td>

          <td>
            <span style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">${formattedDate}</span>
          </td>

          <td style="text-align:center;">
            <button type="button" class="btn-delete" title="Delete Creator" data-action="delete">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                   stroke="currentColor" class="delete-icon">
                <path stroke-linecap="round" stroke-linejoin="round"
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107
                         1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244
                         2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456
                         0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114
                         1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964
                         51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5
                         0a48.667 48.667 0 00-7.5 0"/>
              </svg>
            </button>
          </td>
        </tr>`;
    }).join('');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Inline Cell Editing ───────────────────────────────────────────────────

  tableBody.addEventListener('change', (event) => {
    const target = event.target;
    const row    = target.closest('tr');
    if (!row) return;

    const index = parseInt(row.getAttribute('data-index'), 10);
    const field = target.getAttribute('data-field');
    if (isNaN(index) || !field) return;

    let newValue = target.value.trim();

    // Auto-fix: if username is edited, update profileUrl to match
    if (field === 'username') {
      newValue = newValue.replace(/^@/, '');
      if (newValue && creators[index]) {
        creators[index].profileUrl = `https://www.instagram.com/${newValue}/`;
      }
    }

    // Coerce numeric fields
    if ((field === 'followerCount' || field === 'postCount') && newValue !== '') {
      const numeric = parseInt(newValue.replace(/,/g, ''), 10);
      if (!isNaN(numeric)) newValue = numeric;
    }

    if (!creators[index]) return;

    creators[index][field]      = newValue;
    creators[index].lastUpdated = new Date().toISOString();

    console.log(`[Loopgro] Cell edit: ${field} =`, newValue);

    // Local fallback
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      localStorage.setItem('savedCreators', JSON.stringify(creators));
      renderDashboard();
      return;
    }

    // Remote save via Apps Script
    pushToSheet('saveCreator', { data: creators[index] })
      .then(res => {
        if (res?.success) {
          creators = res.data || creators;
          renderDashboard();
        } else {
          alert('Failed to save: ' + res.error);
          loadDatabase();
        }
      })
      .catch(err => {
        alert('Network error: ' + err.message);
        loadDatabase();
      });
  });

  // ── Row Deletion ──────────────────────────────────────────────────────────

  tableBody.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="delete"]');
    if (!btn) return;

    const row   = btn.closest('tr');
    const index = parseInt(row?.getAttribute('data-index'), 10);
    if (isNaN(index)) return;

    const username = creators[index]?.username || 'this creator';
    if (!confirm(`Delete @${username}? This will remove them from the Google Sheet permanently.`)) return;

    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      creators.splice(index, 1);
      localStorage.setItem('savedCreators', JSON.stringify(creators));
      renderDashboard();
      return;
    }

    pushToSheet('deleteCreator', { username })
      .then(res => {
        if (res?.success) {
          creators = res.data || [];
          renderDashboard();
        } else {
          alert('Delete failed: ' + res.error);
        }
      })
      .catch(err => {
        alert('Network error deleting row: ' + err.message);
      });
  });

  // ── Sheet API Helper ──────────────────────────────────────────────────────

  function pushToSheet(action, extra = {}) {
    return fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, sheetUrl: googleSheetUrl, ...extra }),
    }).then(r => r.json());
  }

  // ── Search ────────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', filterAndDrawRows);

  // ── Mock Data (local dev only) ────────────────────────────────────────────
  function getMockData() {
    return [
      {
        username:      'natgeo',
        profileUrl:    'https://www.instagram.com/natgeo/',
        acceptance:    'Yes',
        followerCount: 207000000,
        postCount:     27300,
        comments:      'Global outreach campaign.',
        lastUpdated:   new Date(Date.now() - 86400000 * 3).toISOString(),
      },
      {
        username:      'nasa',
        profileUrl:    'https://www.instagram.com/nasa/',
        acceptance:    'No',
        followerCount: 97000000,
        postCount:     4100,
        comments:      'Pitch: space-themed collaboration.',
        lastUpdated:   new Date(Date.now() - 86400000 * 2).toISOString(),
      },
      {
        username:      'techcrunch',
        profileUrl:    'https://www.instagram.com/techcrunch/',
        acceptance:    'No',
        followerCount: 10000000,
        postCount:     15000,
        comments:      'Pitching extension release.',
        lastUpdated:   new Date().toISOString(),
      },
    ];
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  loadSettings(() => loadDatabase());
});
