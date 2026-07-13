/**
 * background/background.js
 *
 * Manifest V3 Service Worker — acts as the central event hub.
 * Handles extension install/update lifecycle and relays messages
 * that need to persist after the popup closes.
 */

'use strict';

// ─── Installation / Update Lifecycle ───────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Loopgro] Extension installed successfully.');

    // Seed default outreach message templates
    chrome.storage.local.set({
      outreachTemplates: {
        collab: "Hi {name}! Love your content. We'd love to collaborate on an upcoming campaign — let us know if you're open to it!",
        pr: "Hey {name}, your content is amazing! We'd love to send you a complimentary gift. Reply with your shipping address if interested!",
        custom: "Hey {name}, [Custom Message Here]",
      },
    });

    console.log('[Loopgro] Default templates saved.');
  } else if (details.reason === 'update') {
    console.log(`[Loopgro] Updated to v${chrome.runtime.getManifest().version}`);
  }
});

// ─── Message Broker ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Loopgro] Background received:', request.action);

  // Reserved for future background-only tasks (analytics, scheduled syncs, etc.)
  sendResponse({ status: 'ok' });
  return true;
});
