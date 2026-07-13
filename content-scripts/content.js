/**
 * content-scripts/content.js
 *
 * Injected into every Instagram tab matching https://*.instagram.com/*
 *
 * Extraction priority (most reliable → least reliable):
 *   1. window._sharedData     — legacy embedded JSON
 *   2. __NEXT_DATA__          — Next.js page JSON blob
 *   3. Script tag scanning    — inline JSON containing profile data
 *   4. Meta tags              — og:description ("X Followers, Y Posts")
 *   5. DOM selectors          — multiple modern + legacy selector patterns
 */

'use strict';

console.log('[Loopgro] content.js loaded on', window.location.href);
window.hasOutreachScript = true;

// ─── Message Router ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Loopgro] Message received:', request.action);

  if (request.action === 'getProfileData') {
    extractProfileData()
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (request.action === 'clickMessageButton') {
    const clicked = clickMessageButton();
    sendResponse({ success: clicked });
    return true;
  }
});

// ─── Main Extractor ────────────────────────────────────────────────────────

/**
 * Tries each extraction tier in order and merges results.
 * Throws if username cannot be determined.
 */
async function extractProfileData() {
  const username = getUsername();
  if (!username) throw new Error('Not on a profile page');

  const profileUrl = `https://www.instagram.com/${username}/`;

  // Attempt each data source in priority order
  let followers = null;
  let posts = null;

  const tiers = [
    () => trySharedData(username),
    () => tryNextData(),
    () => tryScriptTags(),
    () => tryMetaTags(),
    () => tryDOMSelectors(),
  ];

  for (const tier of tiers) {
    try {
      const result = tier();
      if (result) {
        if (followers === null && result.followers != null) followers = result.followers;
        if (posts === null && result.posts != null) posts = result.posts;
      }
    } catch (e) {
      console.warn('[Loopgro] Tier error:', e.message);
    }
    if (followers !== null && posts !== null) break;
  }

  const followerCount = followers !== null ? followers : null;
  const postCount = posts !== null ? posts : null;

  console.log('[Loopgro] Extracted:', { username, profileUrl, followerCount, postCount });

  return { username, profileUrl, followerCount, postCount };
}

// ─── Tier 1: window._sharedData ───────────────────────────────────────────

function trySharedData(username) {
  try {
    // Access the page's JS variable via injected script trick
    const raw = document.getElementById('__NEXT_DATA__');
    // _sharedData is no longer accessible from isolated world, skip to Next approach
    // But we can look for it in a <script> tag
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      if (s.textContent && s.textContent.includes('window._sharedData')) {
        const match = s.textContent.match(/window\._sharedData\s*=\s*(\{.+?\});/s);
        if (match) {
          const json = JSON.parse(match[1]);
          const user = json?.entry_data?.ProfilePage?.[0]?.graphql?.user;
          if (user) {
            return {
              followers: user.edge_followed_by?.count ?? null,
              posts: user.edge_owner_to_timeline_media?.count ?? null,
            };
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Loopgro] _sharedData parse failed:', e.message);
  }
  return null;
}

// ─── Tier 2: __NEXT_DATA__ ─────────────────────────────────────────────────

function tryNextData() {
  try {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;

    const json = JSON.parse(el.textContent);

    // Modern Instagram embeds user data in several possible paths
    const searchPaths = [
      json?.props?.pageProps?.data?.user,
      json?.props?.pageProps?.graphql?.user,
      json?.props?.pageProps?.user,
    ];

    for (const user of searchPaths) {
      if (!user) continue;
      const followers = user.edge_followed_by?.count
        ?? user.follower_count
        ?? user.followers_count
        ?? null;
      const posts = user.edge_owner_to_timeline_media?.count
        ?? user.media_count
        ?? null;
      if (followers !== null || posts !== null) {
        return { followers, posts };
      }
    }

    // Deep search for edge_followed_by anywhere in the JSON tree
    const str = el.textContent;
    const followersMatch = str.match(/"edge_followed_by"\s*:\s*\{"count"\s*:\s*(\d+)/);
    const postsMatch = str.match(/"edge_owner_to_timeline_media"\s*:\s*\{"count"\s*:\s*(\d+)/);

    if (followersMatch || postsMatch) {
      return {
        followers: followersMatch ? parseInt(followersMatch[1], 10) : null,
        posts: postsMatch ? parseInt(postsMatch[1], 10) : null,
      };
    }
  } catch (e) {
    console.warn('[Loopgro] __NEXT_DATA__ parse failed:', e.message);
  }
  return null;
}

// ─── Tier 3: Script Tag JSON Scanning ─────────────────────────────────────

function tryScriptTags() {
  try {
    const scripts = Array.from(document.querySelectorAll('script[type="application/json"], script:not([src])'));

    for (const s of scripts) {
      const text = s.textContent;
      if (!text || text.length < 50) continue;

      // Look for follower-related keys in raw JSON text
      if (!text.includes('follower') && !text.includes('edge_followed_by')) continue;

      // Try regex extraction from raw text (avoids full JSON parse of huge blobs)
      const followersMatch = text.match(/"(?:edge_followed_by|follower_count|followers_count)"\s*:\s*(?:\{"count"\s*:\s*)?(\d+)/);
      const postsMatch = text.match(/"(?:edge_owner_to_timeline_media|media_count)"\s*:\s*(?:\{"count"\s*:\s*)?(\d+)/);

      if (followersMatch || postsMatch) {
        return {
          followers: followersMatch ? parseInt(followersMatch[1], 10) : null,
          posts: postsMatch ? parseInt(postsMatch[1], 10) : null,
        };
      }

      // Try full JSON parse as last resort for this script tag
      try {
        const json = JSON.parse(text);
        const result = deepSearch(json, ['edge_followed_by', 'follower_count'], ['edge_owner_to_timeline_media', 'media_count']);
        if (result.followers !== null || result.posts !== null) return result;
      } catch (_) {
        // Not valid JSON, skip
      }
    }
  } catch (e) {
    console.warn('[Loopgro] Script tag scan failed:', e.message);
  }
  return null;
}

/**
 * Recursively searches a JSON object for follower/post count keys.
 */
function deepSearch(obj, followerKeys, postKeys, depth = 0) {
  if (depth > 8 || obj === null || typeof obj !== 'object') {
    return { followers: null, posts: null };
  }

  let followers = null;
  let posts = null;

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (followerKeys.includes(key)) {
      if (typeof val === 'number') followers = val;
      else if (val && typeof val === 'object' && 'count' in val) followers = val.count;
    }

    if (postKeys.includes(key)) {
      if (typeof val === 'number') posts = val;
      else if (val && typeof val === 'object' && 'count' in val) posts = val.count;
    }

    if (followers !== null && posts !== null) break;

    if (val && typeof val === 'object') {
      const nested = deepSearch(val, followerKeys, postKeys, depth + 1);
      if (followers === null && nested.followers !== null) followers = nested.followers;
      if (posts === null && nested.posts !== null) posts = nested.posts;
    }

    if (followers !== null && posts !== null) break;
  }

  return { followers, posts };
}

// ─── Tier 4: Meta Tags ─────────────────────────────────────────────────────

function tryMetaTags() {
  try {
    // og:description format: "123K Followers, 456 Following, 789 Posts – ..."
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
      const content = ogDesc.getAttribute('content') || '';
      // Match patterns like "1.2M Followers" or "456,789 Followers"
      const followersMatch = content.match(/([\d,.]+[KMBkmb]?)\s+Followers/i);
      const postsMatch = content.match(/([\d,.]+[KMBkmb]?)\s+Posts/i);

      return {
        followers: followersMatch ? parseCount(followersMatch[1]) : null,
        posts: postsMatch ? parseCount(postsMatch[1]) : null,
      };
    }
  } catch (e) {
    console.warn('[Loopgro] Meta tag parse failed:', e.message);
  }
  return null;
}

// ─── Tier 5: DOM Selectors ─────────────────────────────────────────────────

function tryDOMSelectors() {
  let followers = null;
  let posts = null;

  try {
    // ── Followers: try the anchor with /followers/ in href ──
    const followersSelectors = [
      'a[href$="/followers/"] span',
      'a[href*="/followers/"] span[title]',
      'a[href*="followers"] span',
    ];

    for (const sel of followersSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        // Prefer title attribute (exact full number, e.g. "1,234,567")
        const title = el.getAttribute('title') || el.closest('a')?.getAttribute('title');
        const text = title || el.textContent;
        if (text) {
          const parsed = parseCount(text.trim());
          if (!isNaN(parsed) && parsed > 0) {
            followers = parsed;
            break;
          }
        }
      }
    }

    // ── Followers: scan all <span title> elements ──
    if (followers === null) {
      const spans = document.querySelectorAll('span[title]');
      for (const span of spans) {
        const title = span.getAttribute('title');
        if (/^[\d,]+$/.test(title.replace(/,/g, ''))) {
          // Is this the followers span? Check if parent/ancestor contains "follower"
          const ancestor = span.closest('li') || span.closest('section') || span.parentElement;
          if (ancestor && /follower/i.test(ancestor.textContent)) {
            followers = parseCount(title);
            break;
          }
        }
      }
    }

    // ── Posts count ──
    const postSelectors = [
      'a[href*="/"] span', // first <li> in header stats usually = posts
    ];

    // Most reliable: find the header stats list
    const headerLis = document.querySelectorAll('header li, header ul li, main header ul li');
    if (headerLis.length >= 1) {
      // Instagram header stats order: Posts | Followers | Following
      const firstLi = headerLis[0];
      const firstText = firstLi?.textContent?.trim();
      if (firstText) {
        const parts = firstText.split(/\s+/);
        const num = parseCount(parts[0]);
        if (!isNaN(num) && num >= 0) posts = num;
      }

      // Re-attempt followers from second li
      if (followers === null && headerLis.length >= 2) {
        const secondLi = headerLis[1];
        // Check for the title attribute on a span inside it
        const titleSpan = secondLi.querySelector('span[title]');
        if (titleSpan) {
          const t = titleSpan.getAttribute('title');
          followers = parseCount(t);
        } else {
          const secondText = secondLi?.textContent?.trim();
          if (secondText) {
            const parts = secondText.split(/\s+/);
            followers = parseCount(parts[0]);
          }
        }
      }
    }

    // ── Fallback: scan spans for "X followers" and "X posts" text ──
    if (followers === null || posts === null) {
      const allSpans = Array.from(document.querySelectorAll('span'));
      for (const span of allSpans) {
        const text = (span.textContent || '').trim();

        if (followers === null && /^([\d,.]+[KMBkmb]?)\s+followers?$/i.test(text)) {
          const m = text.match(/^([\d,.]+[KMBkmb]?)/i);
          if (m) followers = parseCount(m[1]);
        }

        if (posts === null && /^([\d,.]+[KMBkmb]?)\s+posts?$/i.test(text)) {
          const m = text.match(/^([\d,.]+[KMBkmb]?)/i);
          if (m) posts = parseCount(m[1]);
        }

        if (followers !== null && posts !== null) break;
      }
    }
  } catch (e) {
    console.warn('[Loopgro] DOM selector extraction failed:', e.message);
  }

  return { followers, posts };
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Extracts the Instagram username from the current URL path.
 * Returns null if not on a profile page.
 */
function getUsername() {
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);

  const nonProfilePaths = new Set([
    'explore', 'direct', 'reels', 'developer', 'about',
    'press', 'legal', 'accounts', 'stories', 'emails',
    'p', 'tv', 'ar', 'reel', 'feed', 'inbox', 'notifications',
    'live', 'shop', 'create',
  ]);

  if (segments.length === 1 && !nonProfilePaths.has(segments[0])) {
    return segments[0];
  }
  return null;
}

/**
 * Converts human-readable number strings to integers.
 *   "1,234"   → 1234
 *   "12.5K"   → 12500
 *   "3.2M"    → 3200000
 *   "1.1B"    → 1100000000
 *   "633"     → 633
 */
function parseCount(raw) {
  if (raw == null) return NaN;
  const str = String(raw).trim().replace(/,/g, '');
  if (!str) return NaN;

  const multipliers = { k: 1e3, m: 1e6, b: 1e9 };
  const match = str.match(/^([\d.]+)([KMBkmb])?$/i);
  if (!match) return NaN;

  const num = parseFloat(match[1]);
  const suffix = (match[2] || '').toLowerCase();
  return suffix ? Math.round(num * (multipliers[suffix] || 1)) : Math.round(num);
}

/**
 * Clicks the "Message" button on a profile page if present.
 */
function clickMessageButton() {
  const candidates = Array.from(document.querySelectorAll('button, div[role="button"], a'));
  for (const el of candidates) {
    if ((el.textContent || '').trim() === 'Message') {
      try {
        el.click();
        return true;
      } catch (e) {
        console.error('[Loopgro] Click failed:', e);
        return false;
      }
    }
  }
  console.warn('[Loopgro] "Message" button not found in DOM.');
  return false;
}
