// Gemin-Eye Spy Glass – LinkedIn content script
(function () {
  const LOG = (...a) => console.log("%c[Gemin-Eye LI]", "color:#0077B5;font-weight:bold", ...a);
  LOG("content script loaded on", location.href);
  if (window.__geminEyeLiActive) {
    LOG("already active, skipping init");
    return;
  }

  function startScan(business) {
    LOG("startScan() called for business:", business?.businessName);
    if (window.__geminEyeLiActive) { LOG("scan already running"); return; }
    window.__geminEyeLiActive = true;

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
    banner.id = "gemin-eye-li-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#0077B5,#00A0DC);color:white;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:10px;";
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
      window.__geminEyeLiActive = false;
      autoScrolling = false;
      clearInterval(si);
      clearInterval(scrollInterval);
    };

    banner.appendChild(
      document.createTextNode(`Gemin-Eye LinkedIn [${business.businessName}] `),
    );
    banner.appendChild(counter);
    banner.appendChild(pauseBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);

    // LinkedIn obfuscates class names and dropped data-urn/article. Anchor on
    // (1) stable data-testid attributes when present, (2) the "expandable-text-
    // button" testid that lives inside every post, (3) a brute-force text walk
    // of <main> as last resort.
    const TESTID_SELECTORS = [
      "[data-testid='feed-update']",
      "[data-testid='post-content']",
      "[data-testid='update-text']",
      "[data-testid='main-feed-activity-card']",
    ];

    function cleanText(raw) {
      return (raw || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(
          (s) =>
            s.length > 0 &&
            !/^(Like|Comment|Repost|Send|Follow|Reply|See more|See translation|Promoted|\d+\s*(Like|Comment|Repost|reaction|comment|share|impression))/i.test(
              s,
            ),
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 5000);
    }

    function pushIfNew(found, container, text, skippedRef) {
      if (text.length < 25) { skippedRef.short++; return; }
      if (text.length > 5000) { skippedRef.long++; return; }
      if (seenPosts[text]) { skippedRef.seen++; return; }
      found.push({ text, element: container });
    }

    function extractPosts() {
      const found = [];
      const skipped = { short: 0, long: 0, seen: 0 };
      let strategy = "none";

      // Strategy 1: explicit testids
      let containers = document.querySelectorAll(TESTID_SELECTORS.join(","));
      if (containers.length > 0) {
        strategy = "testid";
        containers.forEach((c) => pushIfNew(found, c, cleanText(c.innerText), skipped));
      }

      // Strategy 2: walk up from "expandable-text-button" testids (every post has one)
      if (found.length === 0) {
        const buttons = document.querySelectorAll("button[data-testid='expandable-text-button']");
        if (buttons.length > 0) {
          strategy = "expandable-button";
          containers = new Set();
          buttons.forEach((btn) => {
            // Walk up until we find a sizeable container (parent with > 10 child elements)
            let node = btn.parentElement;
            for (let i = 0; i < 12 && node; i++) {
              if (node.querySelectorAll("button, a").length > 3) {
                containers.add(node);
                break;
              }
              node = node.parentElement;
            }
          });
          containers.forEach((c) => pushIfNew(found, c, cleanText(c.innerText), skipped));
        }
      }

      // Strategy 3: brute-force walk of <main>, grab divs whose direct text is substantial
      if (found.length === 0) {
        const main = document.querySelector("main") || document.body;
        const all = main.querySelectorAll("div");
        strategy = "main-walk";
        const seenLocal = new Set();
        all.forEach((div) => {
          // Only consider leaves-ish: no nested div with text > 100 chars
          const txt = (div.innerText || "").trim();
          if (txt.length < 80 || txt.length > 5000) return;
          // Avoid containers — only take if text isn't already covered by a child
          if (Array.from(div.children).some((ch) => (ch.innerText || "").trim().length > 80)) return;
          if (seenLocal.has(txt)) return;
          seenLocal.add(txt);
          pushIfNew(found, div, cleanText(txt), skipped);
        });
      }

      lastFoundCount = found.length;
      LOG(`extractPosts[${strategy}]: ${found.length} new (short:${skipped.short} long:${skipped.long} seen:${skipped.seen})`);

      if (found.length === 0) {
        const testidNodes = document.querySelectorAll("[data-testid]");
        const ids = new Set();
        testidNodes.forEach((n) => ids.add(n.getAttribute("data-testid")));
        const sample = {
          totalTestids: testidNodes.length,
          uniqueTestids: Array.from(ids).slice(0, 30),
          mainExists: !!document.querySelector("main"),
          mainChildren: document.querySelector("main")?.children.length || 0,
        };
        LOG("page sample:", sample);
      }
      return found;
    }

    function sendPost(text, el) {
      seenPosts[text] = true;
      scannedCount++;
      pendingCount++;
      updateCounter();
      let authorName = "";
      try {
        const card = el.closest(".feed-shared-update-v2");
        if (card) {
          const nameEl = card.querySelector(
            ".update-components-actor__name span[aria-hidden],.feed-shared-actor__name span",
          );
          if (nameEl) authorName = nameEl.innerText || "";
        }
      } catch {}
      LOG(`→ sending to backend (${text.length} chars):`, text.slice(0, 80) + "…");
      chrome.runtime.sendMessage(
        {
          type: "GE_SCAN",
          platform: "linkedin",
          body: {
            postText: text,
            authorName: authorName || "LinkedIn user",
            pageUrl: window.location.href,
          },
        },
        (d) => {
          pendingCount--;
          if (chrome.runtime.lastError) {
            LOG("✗ runtime error:", chrome.runtime.lastError.message);
            failCount++;
          } else if (d && d.matched) {
            LOG("✓ MATCHED lead, score:", d.score ?? "?", "reason:", d.reason ?? "");
            sentCount++;
            el.style.outline = "3px solid #0077B5";
            el.style.outlineOffset = "4px";
            el.style.borderRadius = "4px";
          } else if (!d) {
            LOG("✗ no response from background");
            failCount++;
          } else if (d.reason === "network_error") {
            LOG("✗ network error:", d.error);
            failCount++;
          } else {
            LOG("• not a match. response:", d);
          }
          updateCounter();
        },
      );
    }

    function scan() {
      tickCount++;
      if (document.hidden) { LOG("tab hidden, skipping tick"); updateCounter(); return; }
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
    if (msg?.type === "GE_START_SCAN" && msg.platform === "linkedin") {
      if (msg.business) startScan(msg.business);
      sendResponse({ ok: true });
    }
  });
})();
