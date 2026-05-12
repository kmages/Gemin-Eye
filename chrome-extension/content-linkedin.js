// Gemin-Eye Spy Glass – LinkedIn content script
(function () {
  if (window.__geminEyeLiActive) return;

  function startScan(business) {
    if (window.__geminEyeLiActive) return;
    window.__geminEyeLiActive = true;

    const seenPosts = {};
    let scannedCount = 0,
      sentCount = 0,
      pendingCount = 0,
      failCount = 0,
      autoScrolling = true,
      scrollsDone = 0;
    const maxScrolls = 150;

    const banner = document.createElement("div");
    banner.id = "gemin-eye-li-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#0077B5,#00A0DC);color:white;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:10px;";
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

    function extractPosts() {
      const found = [];
      const els = document.querySelectorAll(
        ".feed-shared-update-v2__description,.feed-shared-inline-show-more-text,.feed-shared-text,.update-components-text,span.break-words",
      );
      els.forEach((el) => {
        const t = (el.innerText || "").trim();
        if (t.length < 25 || t.length > 5000 || seenPosts[t]) return;
        found.push({ text: t, element: el });
      });
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
          if (d && d.matched) {
            sentCount++;
            el.style.outline = "3px solid #0077B5";
            el.style.outlineOffset = "4px";
            el.style.borderRadius = "4px";
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
    if (msg?.type === "GE_START_SCAN" && msg.platform === "linkedin") {
      if (msg.business) startScan(msg.business);
      sendResponse({ ok: true });
    }
  });
})();
