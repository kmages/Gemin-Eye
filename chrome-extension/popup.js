const $ = (id) => document.getElementById(id);

async function load() {
  const { businesses, selectedBusinessId } = await chrome.storage.sync.get([
    "businesses",
    "selectedBusinessId",
  ]);
  if (!businesses || businesses.length === 0) {
    $("setup").style.display = "block";
    $("ready").style.display = "none";
    return;
  }
  $("setup").style.display = "none";
  $("ready").style.display = "block";
  const sel = $("business-select");
  sel.innerHTML = "";
  for (const b of businesses) {
    const opt = document.createElement("option");
    opt.value = String(b.businessId);
    opt.textContent = b.businessName;
    sel.appendChild(opt);
  }
  sel.value = String(selectedBusinessId || businesses[0].businessId);
  sel.onchange = () =>
    chrome.storage.sync.set({ selectedBusinessId: Number(sel.value) });
}

function decodeConfig(raw) {
  const s = (raw || "").trim();
  if (!s) throw new Error("Paste a config first.");
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch {
    try {
      parsed = JSON.parse(atob(s));
    } catch {
      throw new Error("Couldn't read that — make sure you copied the whole config.");
    }
  }
  if (!Array.isArray(parsed)) throw new Error("Config must be a list of businesses.");
  for (const b of parsed) {
    if (!b.businessId || !b.businessName || !b.chatId || !b.token || !b.baseUrl) {
      throw new Error("Config is missing required fields.");
    }
  }
  return parsed;
}

$("save-config").onclick = async () => {
  try {
    const businesses = decodeConfig($("config-input").value);
    await chrome.storage.sync.set({
      businesses,
      selectedBusinessId: businesses[0].businessId,
    });
    $("save-status").textContent = `Saved ${businesses.length} business${businesses.length === 1 ? "" : "es"}.`;
    $("save-status").className = "ok";
    setTimeout(load, 400);
  } catch (e) {
    $("save-status").textContent = e.message;
    $("save-status").className = "err";
  }
};

$("reset").onclick = async () => {
  await chrome.storage.sync.clear();
  load();
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function triggerScan(platform, hostMatch) {
  const tab = await activeTab();
  if (!tab || !tab.url || !hostMatch.test(tab.url)) {
    $("status").textContent =
      platform === "facebook"
        ? "Open a Facebook group page first."
        : "Open a LinkedIn feed/search page first.";
    $("status").className = "err";
    return;
  }
  const { businesses, selectedBusinessId } = await chrome.storage.sync.get([
    "businesses",
    "selectedBusinessId",
  ]);
  const business =
    businesses.find((b) => b.businessId === selectedBusinessId) || businesses[0];
  chrome.tabs.sendMessage(
    tab.id,
    { type: "GE_START_SCAN", platform, business },
    (response) => {
      const err = chrome.runtime.lastError;
      if (response && response.ok) {
        $("status").textContent = `Scanning ${platform} for ${business.businessName}…`;
        $("status").className = "ok";
        setTimeout(() => window.close(), 600);
      } else if (err) {
        $("status").textContent =
          "Reload the page once after installing, then try again.";
        $("status").className = "err";
      } else {
        $("status").textContent = `Scanning ${platform} for ${business.businessName}…`;
        $("status").className = "ok";
        setTimeout(() => window.close(), 600);
      }
    },
  );
}

$("scan-fb").onclick = () => triggerScan("facebook", /facebook\.com/);
$("scan-li").onclick = () => triggerScan("linkedin", /linkedin\.com/);

load();
