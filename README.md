# Loopgro — Instagram Influencer Outreach Chrome Extension

A Chrome extension that streamlines influencer outreach by automatically scraping Instagram profile data and syncing it to a shared Google Sheet CRM.

---

## Features

- **Auto-scrapes** username, profile URL, follower count, and post count from any Instagram profile page
- **Saves directly** to a shared Google Sheet — no manual copy-pasting
- **Deduplication** — updates existing rows instead of creating duplicates
- **CRM Dashboard** — view, search, filter, and inline-edit all saved creators
- **Acceptance tracking** — mark influencers as accepted or not
- **Comments/notes** per creator

---

## Sheet Structure

The Google Sheet uses exactly 7 columns:

| Col | Field |
|-----|-------|
| A | Username |
| B | Instagram Profile URL |
| C | Acceptance |
| D | Follower Count |
| E | Post Count |
| F | Comments |
| G | Last Updated Date & Time |

---

## Setup

### 1. Deploy the Google Apps Script

1. Open [Google Sheets](https://sheets.google.com) and create a blank spreadsheet
2. Go to **Extensions → Apps Script**
3. Delete any default code and paste the contents of `google-apps-script.js`
4. Save (Ctrl+S)
5. Click **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** and copy the Web App URL

### 2. Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked** and select this project folder

### 3. Configure the Extension

1. Click the Loopgro extension icon → **CRM Dashboard**
2. Go to the **Settings** tab
3. Paste your **Google Sheet URL** and **Apps Script Web App URL**
4. Click **Save Settings** then **Test Connection**

---

## Usage

1. Navigate to any Instagram profile (e.g. `instagram.com/natgeo`)
2. Click the Loopgro extension icon
3. The popup auto-fills the username, URL, follower count, and post count
4. Add notes and set acceptance status if needed
5. Click **Save Creator** — data goes straight into your Google Sheet

---

## Project Structure

```
├── background/
│   └── background.js       # Service worker (MV3)
├── content-scripts/
│   └── content.js          # Instagram scraper (5-tier extraction)
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js        # CRM dashboard controller
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js            # Popup UI controller
├── assets/                 # Icons and images
├── icons/                  # Extension icons
├── google-apps-script.js   # Apps Script backend (deploy to Google)
├── manifest.json
└── theme.css               # Shared design tokens
```

---

## Scraper Strategy

The content script uses a 5-tier extraction approach to handle Instagram's frequent UI changes:

1. `window._sharedData` — legacy embedded JSON
2. `__NEXT_DATA__` — Next.js page data blob
3. Script tag scanning — inline JSON search
4. Meta tags — `og:description` parsing
5. DOM selectors — multiple modern selector patterns

Follower/post counts are always converted to integers (`12.5K` → `12500`, `3.2M` → `3200000`).

---

## Requirements

- Google Chrome (or any Chromium-based browser)
- A Google account to host the Apps Script backend
- Access to the shared Google Sheet
