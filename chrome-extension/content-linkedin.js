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

    // Anchor on stable LinkedIn data attributes for post containers.
    // The text-bearing inner elements have changed names many times, so we
    // walk the whole post container and pull its innerText.
    const POST_CONTAINERS = [
      "div[data-urn^='urn:li:activity']",
      "div[data-id^='urn:li:activity']",
      "div[data-urn^='urn:li:share']",
      "div.feed-shared-update-v2",
      "div.fie-impression-container",
    ];
    function extractPosts() {
      const found = [];
      const containerSel = POST_CONTAINERS.join(",");
      const containers = document.querySelectorAll(containerSel);
      lastFoundCount = containers.length;
      let skippedShort = 0, skippedLong = 0, skippedSeen = 0;
      containers.forEach((container) => {
        // Strip nav/buttons/comments by cloning and removing button/nav children
        const text = (container.innerText || "")
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !/^(Like|Comment|Repost|Send|Follow|Reply|See more|See translation|\d+ (Like|Comment|Repost|reaction|comment|share))/i.test(s))
          .join(" ")
          .slice(0, 5000);
        if (text.length < 25) { skippedShort++; return; }
        if (text.length > 5000) { skippedLong++; return; }
        if (seenPosts[text]) { skippedSeen++; return; }
        found.push({ text, element: container });
      });
      LOG(`extractPosts: ${containers.length} containers, ${found.length} new (short:${skippedShort} long:${skippedLong} seen:${skippedSeen})`);
      if (containers.length === 0) {
        LOG("⚠ No post containers. Selectors tried:", POST_CONTAINERS);
        // Sample what IS on the page for diagnosis
        const sample = {
          urn: document.querySelectorAll("[data-urn]").length,
          dataId: document.querySelectorAll("[data-id]").length,
          articles: document.querySelectorAll("article").length,
          mainExists: !!document.querySelector("main"),
        };
        LOG("page sample:", sample);
        const anyUrn = document.querySelector("[data-urn]");
        if (anyUrn) LOG("first [data-urn] value:", anyUrn.getAttribute("data-urn"));
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
