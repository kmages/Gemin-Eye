// Gemin-Eye Spy Glass – Facebook content script
// Same scan UX as the old bookmarklet, but routes API calls through the
// extension's background worker (no popup relay, works in N tabs at once).

(function () {
  const LOG = (...a) => console.log("%c[Gemin-Eye FB]", "color:#6d28d9;font-weight:bold", ...a);
  LOG("content script loaded on", location.href);
  if (window.__geminEyeFbActive) { LOG("already active, skipping init"); return; }

  function startScan(business) {
    LOG("startScan() called for business:", business?.businessName);
    if (window.__geminEyeFbActive) { LOG("scan already running"); return; }
    window.__geminEyeFbActive = true;

    const seenPosts = {};
    let scannedCount = 0,
      sentCount = 0,
      pendingCount = 0,
      failCount = 0,
      autoScrolling = true,
      scrollsDone = 0;
    const maxScrolls = 150;

    const banner = document.createElement("div");
    banner.id = "gemin-eye-fb-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#4338ca,#6d28d9);color:white;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:10px;";

    const counter = document.createElement("span");
    counter.style.cssText = "font-weight:normal;opacity:0.85;font-size:13px;";
    counter.textContent = "0 scanned";

    function updateCounter() {
      let t = `${scannedCount} scanned, ${sentCount} leads`;
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
      document.createTextNode(`Gemin-Eye [${business.businessName}] `),
    );
    banner.appendChild(counter);
    banner.appendChild(pauseBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);

    function extractPosts() {
      const found = [];
      const els = document.querySelectorAll('div[dir="auto"]');
      let skippedShort = 0, skippedSeen = 0, skippedLink = 0;
      els.forEach((el) => {
        const t = (el.innerText || "").trim();
        if (t.length < 25 || t.length > 5000) { skippedShort++; return; }
        if (seenPosts[t]) { skippedSeen++; return; }
        const a = el.closest("a");
        if (a && a.href && a.href.indexOf("/comment") === -1) { skippedLink++; return; }
        found.push({ text: t, element: el });
      });
      LOG(`extractPosts: ${els.length} dir=auto, ${found.length} new (short/long:${skippedShort} seen:${skippedSeen} link:${skippedLink})`);
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
            groupName: groupName || document.title || "Facebook Group",
            pageUrl: window.location.href,
          },
        },
        (d) => {
          pendingCount--;
          if (d && d.matched) {
            if (d.reason === "post_too_old") {
              el.style.outline = "2px dashed #999";
              el.style.outlineOffset = "4px";
              el.style.borderRadius = "4px";
            } else {
              sentCount++;
              el.style.outline = "3px solid #6d28d9";
              el.style.outlineOffset = "4px";
              el.style.borderRadius = "4px";
            }
          } else if (!d || d.reason === "network_error") {
            failCount++;
          }
          updateCounter();
        },
      );
    }

    function scan() {
      if (document.hidden) return;
      const posts = extractPosts();
      posts.forEach((p) => {
        if (scannedCount >= 500) return;
        sendPost(p.text, p.element);
      });
      if (scannedCount >= 500) {
        autoScrolling = false;
        updateCounter();
      }
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && scrollsDone < maxScrolls && scannedCount < 500) {
        autoScrolling = true;
        pauseBtn.textContent = "Pause";
      }
    });

    scan();
    const si = setInterval(scan, 2000);
    const scrollInterval = setInterval(() => {
      if (!autoScrolling || document.hidden) return;
      scrollsDone++;
      if (scrollsDone >= maxScrolls) {
        autoScrolling = false;
        updateCounter();
        return;
      }
      window.scrollBy({ top: 600, behavior: "smooth" });
    }, 1500);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "GE_START_SCAN" && msg.platform === "facebook") {
      if (msg.business) startScan(msg.business);
      sendResponse({ ok: true });
    }
  });
})();
