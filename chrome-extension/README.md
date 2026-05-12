# Gemin-Eye Spy Glass — Chrome Extension

Replaces the Facebook / LinkedIn bookmarklets. Works across multiple tabs and windows simultaneously because all API calls go through the extension's single background service worker (no popup relay window required).

## Install (developer mode)

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `chrome-extension/` folder from this repo.
4. Pin the **Gemin-Eye Spy Glass** icon to the toolbar.

## First-time setup

1. Open your Gemin-Eye dashboard → **Spy Glass Tools** card → **Chrome Extension** section.
2. Click **Copy config**.
3. Click the extension icon → paste the config → **Save config**.

You only do this once per browser. The config holds your business + auth token; rotate it from the dashboard if needed.

## Use

- Open a Facebook group page or LinkedIn feed/search page.
- Click the extension icon → pick the business → **Scan Facebook** or **Scan LinkedIn**.
- A purple/blue banner appears at the top of the page with live counts.
- Leads stream into Telegram in real time.
- Open multiple tabs / windows — they all scan independently and feed the same Telegram chat. No more popup relay limits.

## Files

- `manifest.json` — MV3 manifest, host permissions for facebook.com, linkedin.com, gemin-eye.com.
- `background.js` — service worker; receives scan messages, POSTs to `/api/fb-scan` or `/api/li-scan`.
- `content-facebook.js` / `content-linkedin.js` — banner UI + DOM extraction + autoscroll. Sends posts to the background worker via `chrome.runtime.sendMessage`.
- `popup.html` / `popup.js` — first-time config + per-tab "Scan now" trigger.
