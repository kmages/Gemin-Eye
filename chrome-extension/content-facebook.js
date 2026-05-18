// Gemin-Eye Spy Glass – Facebook content script
// Handles: group feeds, global posts search, in-group search.
// Same scan pipeline as LinkedIn, routes through background SW.

(function () {
  const LOG = (...a) => console.log("%c[Gemin-Eye FB]", "color:#6d28d9;font-weight:bold", ...a);
  LOG("content script loaded on", location.href);
  if (window.__geminEyeFbActive) { LOG("already active, skipping init"); return; }

  // Detect which FB surface we're on. Exposed for testing.
  function detectMode(path) {
    if (/^\/search\/posts\b/.test(path)) return "Posts Search";
    if (/^\/groups\/[^/]+\/search\b/.test(path)) return "Group Search";
    if (/^\/groups\/[^/]+\b/.test(path)) return "Group Feed";
    if (/^\/marketplace\b/.test(path)) return "Marketplace";
    return "Feed";
  }
  // Exposed for unit tests (no-op in browser).
  if (typeof module !== "undefined") module.exports = { detectMode };

  function startScan(business) {
    LOG("startScan() called for business:", business?.businessName);
    if (window.__geminEyeFbActive) { LOG("scan already running"); return; }
    window.__geminEyeFbActive = true;

    const modeLabel = detectMode(location.pathname);
    const isSearch = modeLabel === "Posts Search" || modeLabel === "Group Search";
    LOG(`mode: ${modeLabel} (path: ${location.pathname})`);

    const seenPosts = {};
    let scannedCount = 0,
      sentCount = 0,
      pendingCount = 0,
      failCount = 0,
      autoScrolling = true,
      scrollsDone = 0,
      lastFoundCount = 0,
      tickCount = 0;
    const maxScrolls = 150;

    const banner = document.createElement("div");
    banner.id = "gemin-eye-fb-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#4338ca,#6d28d9);color:white;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:10px;";

    const counter = document.createElement("span");
    counter.style.cssText = "font-weight:normal;opacity:0.85;font-size:13px;";
    counter.textContent = "0 scanned";

    function updateCounter() {
      let t = `${scannedCount} scanned, ${sentCount} leads · DOM:${lastFoundCount} · ticks:${tickCount}`;
      if (failCount > 0) t += `, ${failCount} failed`;
      if (pendingCount > 0) t += ` (${pendingCount} checking…)`;
      if (!autoScrolling && scrollsDone >= maxScrolls) t += " — Done";
      counter.textContent = t;
    }

    const pauseBtn = document.createElement("span");
    pauseBtn.textContent = "Pause";
    pauseBtn.style.cssText =
      "cursor:pointer;background:rgba(255,255,255,0.25);padding:4px 14px;border-radius:4px;font-size:12px;font-weight:700;";
    pauseBtn.onclick = () => {
      autoScrolling = !autoScrolling;
      pauseBtn.textContent = autoScrolling ? "Pause" : "Resume";
    };

    const closeBtn = document.createElement("span");
    closeBtn.textContent = "[X] Close";
    closeBtn.style.cssText =
      "cursor:pointer;background:rgba(255,0,0,0.35);padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;margin-left:4px;";
    closeBtn.onclick = () => {
      banner.remove();
      window.__geminEyeFbActive = false;
      autoScrolling = false;
      clearInterval(si);
      clearInterval(scrollInterval);
    };

    banner.appendChild(
      document.createTextNode(`Gemin-Eye Facebook ${modeLabel} [${business.businessName}] `),
    );
    banner.appendChild(counter);
    banner.appendChild(pauseBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);

    function pushIfNew(found, container, text, skipped) {
      if (text.length < 25) { skipped.short++; return; }
      if (text.length > 5000) { skipped.long++; return; }
      if (seenPosts[text]) { skipped.seen++; return; }
      found.push({ text, element: container });
    }

    function extractPosts() {
      const found = [];
      const skipped = { short: 0, long: 0, seen: 0, link: 0 };
      let strategy = "none";

      // Strategy 0: role="article" — every FB post wrapper carries it for a11y.
      // This is the most stable hook FB has, and works on feeds AND search.
      const articles = document.querySelectorAll('div[role="article"]');
      if (articles.length > 0) {
        strategy = "role-article";
        articles.forEach((art) => {
          // The post text is usually in a data-ad-rendering-role="story_message"
          // child, but on search results it can be a plain div[dir="auto"].
          const story =
            art.querySelector('[data-ad-rendering-role="story_message"]') ||
            art.querySelector('[data-ad-comet-preview="message"]') ||
            art.querySelector('div[dir="auto"]') ||
            art;
          const t = (story.innerText || "").trim();
          pushIfNew(found, art, t, skipped);
        });
      }

      // Strategy 1 (fallback): the old dir="auto" walk
      if (found.length === 0) {
        strategy = "dir-auto";
        const els = document.querySelectorAll('div[dir="auto"]');
        els.forEach((el) => {
          const t = (el.innerText || "").trim();
          if (t.length < 25 || t.length > 5000) { skipped.short++; return; }
          if (seenPosts[t]) { skipped.seen++; return; }
          const a = el.closest("a");
          if (a && a.href && a.href.indexOf("/comment") === -1) { skipped.link++; return; }
          found.push({ text: t, element: el });
        });
      }

      lastFoundCount = found.length;
      LOG(
        `extractPosts[${strategy}]: ${found.length} new ` +
        `(short:${skipped.short} long:${skipped.long} seen:${skipped.seen} link:${skipped.link})`,
      );
      found.forEach((p, i) => {
        console.log(
          `%c[Gemin-Eye FB] POST #${scannedCount + i + 1} (${p.text.length} chars):\n%c${p.text}\n%c—————————————————————————————`,
          "color:#6d28d9;font-weight:bold;font-size:12px",
          "color:#222;background:#f5f0ff;padding:4px 8px;border-left:3px solid #6d28d9;display:block;white-space:pre-wrap",
          "color:#999",
        );
      });
      return found;
    }

    function getPostAge(el) {
      try {
        let container =
          el.closest('[role="article"]') ||
          el.closest(".x1yztbdb") ||
          el.parentElement;
        const rp = /^\d+[smhdwy]$/;
        const rl =
          /^(just now|yesterday|\d+\s+(min|minute|hour|hr|day|week|month|mo|year|yr)s?\s+ago)$/i;
        const rd = /^[A-Z][a-z]+\s+\d{1,2}(,?\s+\d{4})?/;
        const rn = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
        const isTs = (t) => {
          t = t.trim();
          return rp.test(t) || rl.test(t) || rd.test(t) || rn.test(t);
        };
        for (let i = 0; i < 6 && container; i++) {
          const links = container.querySelectorAll(
            'a[href*="/posts/"],a[href*="/permalink/"],a[href*="comment_id"],a[role="link"]',
          );
          for (const link of links) {
            const lt = (link.innerText || "").trim();
            if (isTs(lt)) return lt;
            const al = link.getAttribute("aria-label") || "";
            if (isTs(al)) return al.trim();
          }
          const els2 = container.querySelectorAll("abbr,time,span[id]");
          for (const e of els2) {
            const at = (e.innerText || "").trim();
            if (isTs(at)) return at;
            const ti = e.getAttribute("title") || "";
            if (isTs(ti)) return ti.trim();
            const dt = e.getAttribute("datetime") || "";
            if (dt) {
              try {
                const dd = new Date(dt);
                if (!isNaN(dd.getTime())) {
                  const diff = Date.now() - dd.getTime();
                  const hrs = Math.floor(diff / 3600000);
                  if (hrs < 1) return "just now";
                  if (hrs < 24) return hrs + "h";
                  const days = Math.floor(hrs / 24);
                  if (days < 7) return days + "d";
                  const wks = Math.floor(days / 7);
                  if (wks < 5) return wks + "w";
                  return Math.floor(days / 30) + "mo";
                }
              } catch {}
            }
          }
          container = container.parentElement;
        }
      } catch {}
      return "";
    }

    function sendPost(text, el) {
      seenPosts[text] = true;
      scannedCount++;
      pendingCount++;
      updateCounter();
      const postNum = scannedCount;
      const postAge = getPostAge(el);
      let groupName = "";
      const h1 = document.querySelector("h1");
      if (h1) groupName = h1.innerText || "";
      if (!groupName) {
        const titleEl = document.querySelector(
          '[role="banner"] a[href*="/groups/"]',
        );
        if (titleEl) groupName = titleEl.innerText || "";
      }
      chrome.runtime.sendMessage(
        {
          type: "GE_SCAN",
          platform: "facebook",
          body: {
            postText: text,
            postAge,
            groupName: groupName || document.title || "Facebook",
            pageUrl: window.location.href,
          },
        },
        (d) => {
          pendingCount--;
          if (chrome.runtime.lastError) {
            LOG(`✗ POST #${postNum} runtime error:`, chrome.runtime.lastError.message);
            failCount++;
          } else if (d && d.matched) {
            if (d.reason === "post_too_old") {
              LOG(`◌ POST #${postNum} matched but too old (${postAge || "?"})`);
              el.style.outline = "2px dashed #999";
              el.style.outlineOffset = "4px";
              el.style.borderRadius = "4px";
            } else {
              LOG(`✓ POST #${postNum} MATCHED LEAD, score:`, d.score ?? "?");
              sentCount++;
              el.style.outline = "3px solid #6d28d9";
              el.style.outlineOffset = "4px";
              el.style.borderRadius = "4px";
            }
          } else if (!d) {
            LOG(`✗ POST #${postNum} no response from background`);
            failCount++;
          } else if (d.reason === "network_error") {
            LOG(`✗ POST #${postNum} network error:`, d.error);
            failCount++;
          } else {
            const parts = [`reason: ${d.reason || "unknown"}`];
            if (typeof d.score === "number") parts.push(`score: ${d.score}/10`);
            if (typeof d.threshold === "number") parts.push(`threshold: ${d.threshold}`);
            LOG(`• POST #${postNum} not a match. ${parts.join(" · ")}`);
          }
          updateCounter();
        },
      );
    }

    function scan() {
      tickCount++;
      if (document.hidden) { updateCounter(); return; }
      const posts = extractPosts();
      posts.forEach((p) => {
        if (scannedCount >= 500) return;
        sendPost(p.text, p.element);
      });
      if (scannedCount >= 500) {
        LOG("hit 500 cap, stopping");
        autoScrolling = false;
      }
      updateCounter();
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && scrollsDone < maxScrolls && scannedCount < 500) {
        autoScrolling = true;
        pauseBtn.textContent = "Pause";
      }
    });

    // ── Aggressive scroll: same strategy as LinkedIn v1.0.7 ────────────────────
    function findScroller() {
      const candidates = [
        document.scrollingElement,
        document.documentElement,
        document.body,
        document.querySelector('[role="main"]'),
        document.querySelector("main"),
        ...document.querySelectorAll("div"),
      ].filter(Boolean);
      for (const el of candidates) {
        if (!el || !el.scrollHeight) continue;
        if (el.scrollHeight - el.clientHeight > 200) {
          const style = el === document.scrollingElement ? null : getComputedStyle(el);
          if (!style || /(auto|scroll)/.test(style.overflowY)) return el;
        }
      }
      return document.scrollingElement || document.documentElement;
    }
    let scroller = findScroller();
    LOG("scroll target:", scroller?.tagName, (scroller?.className || "").slice(0, 40), "scrollHeight:", scroller?.scrollHeight);

    // Track most-recent extracted post for scrollIntoView fallback
    let lastPostEl = null;
    const _origExtract = extractPosts;
    extractPosts = function () {
      const r = _origExtract();
      if (r.length) lastPostEl = r[r.length - 1].element;
      return r;
    };

    scan();
    const si = setInterval(scan, 2000);
    let lastScrollTop = scroller.scrollTop;
    let stuckCount = 0;
    const scrollInterval = setInterval(() => {
      if (!autoScrolling || document.hidden) return;
      scrollsDone++;
      if (scrollsDone >= maxScrolls) {
        autoScrolling = false;
        LOG(`reached maxScrolls=${maxScrolls}, stopping auto-scroll`);
        updateCounter();
        return;
      }
      const before = scroller.scrollTop;
      try {
        const a = document.activeElement;
        if (a && a !== document.body && typeof a.blur === "function") a.blur();
      } catch {}
      if (lastPostEl && lastPostEl.isConnected) {
        try { lastPostEl.scrollIntoView({ behavior: "instant", block: "end" }); } catch {}
      }
      try { scroller.scrollBy({ top: 1200, behavior: "instant" }); } catch {
        try { scroller.scrollBy(0, 1200); } catch {}
      }
      try { window.scrollBy(0, 1200); } catch {}
      try { scroller.scrollTop = before + 1200; } catch {}
      try {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 1200, bubbles: true, cancelable: true }));
      } catch {}

      setTimeout(() => {
        const after = scroller.scrollTop;
        if (after === lastScrollTop) {
          stuckCount++;
          if (stuckCount === 3) {
            LOG(`⚠ scroll stuck at ${after}px after 3 attempts — re-detecting scroll target`);
            const newScroller = findScroller();
            if (newScroller && newScroller !== scroller) {
              LOG(`switching scroller to ${newScroller.tagName}.${(newScroller.className || "").slice(0, 30)}`);
              scroller = newScroller;
            }
          }
          if (stuckCount >= 8) {
            LOG(`⚠ giving up auto-scroll after 8 stuck attempts. Scroll manually — scanner keeps running.`);
            autoScrolling = false;
            updateCounter();
          }
        } else {
          if (stuckCount > 0) LOG(`scroll resumed (${lastScrollTop} → ${after}px)`);
          stuckCount = 0;
        }
        lastScrollTop = after;
      }, 700);
    }, 1500);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "GE_START_SCAN" && msg.platform === "facebook") {
      if (msg.business) startScan(msg.business);
      sendResponse({ ok: true });
    }
  });
})();
