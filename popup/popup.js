/**
 * popup/popup.js
 *
 * Controls the extension popup UI.
 * Responsibilities:
 *   1. Query the active tab and trigger profile extraction via content.js
 *   2. Render scraped data in the popup form
 *   3. Validate data before saving
 *   4. POST validated data to Google Apps Script Web App → Google Sheet
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Loopgro] Popup initialized.');

  // ── State ────────────────────────────────────────────────────────────────
  let currentProfile = null;

  // ── DOM References ───────────────────────────────────────────────────────
  const statusBadge        = document.getElementById('statusBadge');
  const settingsLink       = document.getElementById('settingsLink');
  const openDashboardLink  = document.getElementById('openDashboardLink');
  const placeholderText    = document.getElementById('placeholderText');
  const profileDataDiv     = document.getElementById('profileData');
  const usernameVal        = document.getElementById('usernameVal');
  const urlVal             = document.getElementById('urlVal');
  const followerCountInput = document.getElementById('followerCountInput');
  const postCountInput     = document.getElementById('postCountInput');
  const commentsInput      = document.getElementById('commentsInput');
  const acceptanceToggle   = document.getElementById('acceptanceToggle');
  const acceptanceValue    = document.getElementById('acceptanceValue');
  const saveCreatorBtn     = document.getElementById('saveCreatorBtn');
  const dashboardBtn       = document.getElementById('dashboardBtn');

  // Controls that are only active when a profile is loaded
  const creatorFormControls = [followerCountInput, postCountInput, commentsInput, saveCreatorBtn];

  // ── Helpers ───────────────────────────────────────────────────────────────

  function setFormDisabledState(disabled) {
    creatorFormControls.forEach(ctrl => {
      if (!ctrl) return;
      ctrl.disabled = disabled;
      ctrl.style.opacity = disabled ? '0.5' : '1';
      ctrl.style.cursor  = disabled ? 'not-allowed' : '';
    });

    if (acceptanceToggle) {
      if (disabled) {
        acceptanceToggle.setAttribute('disabled', 'true');
        acceptanceToggle.style.opacity = '0.5';
        acceptanceToggle.style.cursor  = 'not-allowed';
      } else {
        acceptanceToggle.removeAttribute('disabled');
        acceptanceToggle.style.opacity = '1';
        acceptanceToggle.style.cursor  = '';
      }
    }
  }

  function updateStatus(text, type = 'info') {
    statusBadge.textContent = text;

    const styles = {
      success: { color: 'var(--accent-success)', bg: 'var(--accent-success-bg)', border: 'rgba(16,185,129,0.2)' },
      info:    { color: '#3b82f6',               bg: '#eff6ff',                  border: 'rgba(59,130,246,0.2)' },
      error:   { color: '#ef4444',               bg: '#fef2f2',                  border: 'rgba(239,68,68,0.2)'  },
    };
    const s = styles[type] || styles.info;
    statusBadge.style.color           = s.color;
    statusBadge.style.backgroundColor = s.bg;
    statusBadge.style.borderColor     = s.border;

    setTimeout(() => {
      statusBadge.textContent        = 'Active';
      statusBadge.style.color           = '';
      statusBadge.style.backgroundColor = '';
      statusBadge.style.borderColor     = '';
    }, 2000);
  }

  function setAcceptanceValue(val) {
    acceptanceValue.value = val;
    const options = acceptanceToggle.querySelectorAll('.slide-toggle-option');
    if (val === 'Yes') {
      acceptanceToggle.classList.add('yes');
      options[0]?.classList.remove('active');
      options[1]?.classList.add('active');
    } else {
      acceptanceToggle.classList.remove('yes');
      options[0]?.classList.add('active');
      options[1]?.classList.remove('active');
    }
  }

  /** Format a raw number as a human-readable string for the input field */
  function formatCount(val) {
    if (val == null || val === '') return '';
    const n = Number(val);
    if (isNaN(n)) return String(val);
    return n.toLocaleString('en-US');
  }

  /** Strip formatting to get a plain integer string */
  function stripFormatting(str) {
    return String(str).replace(/,/g, '').trim();
  }

  // ── Toggle Listener ───────────────────────────────────────────────────────
  if (acceptanceToggle) {
    acceptanceToggle.addEventListener('click', () => {
      if (acceptanceToggle.hasAttribute('disabled')) return;
      setAcceptanceValue(acceptanceValue.value === 'Yes' ? 'No' : 'Yes');
    });
  }

  // ── UI Rendering ──────────────────────────────────────────────────────────

  function updateUIWithProfileData(profile) {
    if (!profile || !profile.username) {
      showNoProfileMessage();
      return;
    }

    currentProfile = profile;

    usernameVal.textContent = `@${profile.username}`;
    urlVal.href        = profile.profileUrl;
    urlVal.textContent = profile.profileUrl.replace(/^https?:\/\/(www\.)?/, '');

    // Populate scraped stats — show formatted numbers in inputs
    followerCountInput.value = profile.followerCount != null ? formatCount(profile.followerCount) : '';
    postCountInput.value     = profile.postCount     != null ? formatCount(profile.postCount)     : '';
    setAcceptanceValue('No');

    profileDataDiv.classList.remove('hidden');
    placeholderText.classList.add('hidden');
    setFormDisabledState(false);
  }

  function showNoProfileMessage(msg) {
    currentProfile = null;
    placeholderText.textContent = msg || 'Open an Instagram creator profile.';
    placeholderText.classList.remove('hidden');
    profileDataDiv.classList.add('hidden');
    setFormDisabledState(true);
    followerCountInput.value = '';
    postCountInput.value     = '';
    setAcceptanceValue('No');
  }

  // ── Content Script Injection & Scraping ───────────────────────────────────

  function ensureContentScript(tabId, callback) {
    chrome.scripting.executeScript(
      { target: { tabId }, func: () => window.hasOutreachScript === true },
      (results) => {
        if (chrome.runtime.lastError) {
          callback(false);
          return;
        }
        const loaded = results?.[0]?.result === true;
        if (loaded) {
          callback(true);
        } else {
          chrome.scripting.executeScript(
            { target: { tabId }, files: ['content-scripts/content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                console.error('[Loopgro] Injection failed:', chrome.runtime.lastError.message);
                callback(false);
                return;
              }
              callback(true);
            }
          );
        }
      }
    );
  }

  function checkAndScrape(tabId) {
    ensureContentScript(tabId, (ok) => {
      if (!ok) {
        showNoProfileMessage('Could not inject scraper. Try reloading the page.');
        return;
      }
      chrome.tabs.sendMessage(tabId, { action: 'getProfileData' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Loopgro] Message error:', chrome.runtime.lastError.message);
          showNoProfileMessage();
          return;
        }
        if (response?.success && response.data) {
          updateUIWithProfileData(response.data);
        } else {
          showNoProfileMessage(response?.error || 'Could not extract profile data.');
        }
      });
    });
  }

  // ── Initial Tab Detection ──────────────────────────────────────────────────

  if (typeof chrome === 'undefined' || !chrome.tabs) {
    // Local development mock
    setTimeout(() => updateUIWithProfileData({
      username: 'natgeo',
      profileUrl: 'https://www.instagram.com/natgeo/',
      followerCount: 207000000,
      postCount: 27300,
    }), 300);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.url) { showNoProfileMessage(); return; }

      if (tab.url.includes('instagram.com')) {
        placeholderText.textContent = 'Scraping profile…';
        checkAndScrape(tab.id);
      } else {
        showNoProfileMessage();
      }
    });
  }

  // ── Save Creator ───────────────────────────────────────────────────────────

  saveCreatorBtn.addEventListener('click', () => {
    if (!currentProfile) return;

    // ── Build payload with clean numeric values ──
    const rawFollowers = stripFormatting(followerCountInput.value);
    const rawPosts     = stripFormatting(postCountInput.value);

    // ── Validation ──
    const username   = (currentProfile.username || '').trim();
    const profileUrl = (currentProfile.profileUrl || '').trim();

    if (!username) {
      alert('Validation error: Username is empty.');
      return;
    }

    if (!profileUrl.startsWith('https://www.instagram.com/')) {
      alert(`Validation error: Profile URL is invalid.\nExpected: https://www.instagram.com/…\nGot: ${profileUrl}`);
      return;
    }

    if (!rawFollowers || isNaN(Number(rawFollowers))) {
      alert('Validation error: Follower count must be a number.\nYou can edit the field manually if the scraper could not extract it.');
      return;
    }

    if (!rawPosts || isNaN(Number(rawPosts))) {
      alert('Validation error: Post count must be a number.\nYou can edit the field manually if the scraper could not extract it.');
      return;
    }

    const creatorData = {
      username,
      profileUrl,
      acceptance:    acceptanceValue.value || 'No',
      followerCount: parseInt(rawFollowers, 10),
      postCount:     parseInt(rawPosts, 10),
      comments:      (commentsInput.value || '').trim(),
    };

    // ── Local fallback (browser testing) ──
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      const key = 'savedCreators';
      let list = [];
      try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
      const idx = list.findIndex(c => c.username.toLowerCase() === username.toLowerCase());
      if (idx > -1) list[idx] = { ...list[idx], ...creatorData };
      else list.push(creatorData);
      localStorage.setItem(key, JSON.stringify(list));
      updateStatus('Saved (Local)!', 'success');
      return;
    }

    // ── Extension flow: POST to Apps Script ──
    chrome.storage.local.get(['googleSheetUrl', 'appsScriptUrl'], (result) => {
      const sheetUrl  = result.googleSheetUrl;
      const scriptUrl = result.appsScriptUrl;

      if (!sheetUrl || !scriptUrl) {
        alert('Please configure your Google Sheet URL and Apps Script URL in the CRM settings first!');
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#settings') });
        updateStatus('Configure!', 'info');
        return;
      }

      updateStatus('Saving…', 'info');

      fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveCreator', sheetUrl, data: creatorData }),
      })
        .then(r => r.json())
        .then(res => {
          if (res?.success) {
            updateStatus('Saved! ✓', 'success');
            console.log('[Loopgro] Saved to Google Sheets:', res.data);
          } else {
            console.error('[Loopgro] Save failed:', res.error);
            updateStatus('Error!', 'error');
            alert('Save failed: ' + (res.error || 'Unknown error'));
          }
        })
        .catch(err => {
          console.error('[Loopgro] Network error:', err);
          updateStatus('Error!', 'error');
          alert('Network error connecting to Google Sheets. Check your Apps Script URL.');
        });
    });
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  dashboardBtn.addEventListener('click', () => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      window.open('../dashboard/dashboard.html', '_blank');
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    }
  });

  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      window.open('../dashboard/dashboard.html#settings', '_blank');
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#settings') });
    }
  });

  openDashboardLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      window.open('../dashboard/dashboard.html', '_blank');
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    }
  });
});
