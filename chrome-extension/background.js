// Gemin-Eye Spy Glass – background service worker
// Receives scan payloads from content scripts and POSTs them to the API.
// Running the network call here (instead of in each tab) is what fixes the
// "multiple windows" failure mode of the bookmarklets — there's exactly one
// service worker per browser, no popup relay required.

async function getActiveBusiness() {
  const { selectedBusinessId, businesses } = await chrome.storage.sync.get([
    "selectedBusinessId",
    "businesses",
  ]);
  if (!businesses || businesses.length === 0) return null;
  const picked =
    businesses.find((b) => b.businessId === selectedBusinessId) || businesses[0];
  return picked || null;
}

const LOG = (...a) => console.log("%c[Gemin-Eye SW]", "color:#7c3aed;font-weight:bold", ...a);

async function postScan(platform, body) {
  const biz = await getActiveBusiness();
  if (!biz) {
    LOG("no active business — extension not configured");
    return { matched: false, reason: "extension_not_configured" };
  }
  const url = `${biz.baseUrl.replace(/\/$/, "")}/api/${platform === "facebook" ? "fb-scan" : "li-scan"}`;
  const payload = {
    chatId: biz.chatId,
    businessId: biz.businessId,
    token: biz.token,
    ...body,
  };
  LOG(`POST ${url} (${body.postText?.length || 0} chars)`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    LOG(`← ${res.status}`, data);
    return data;
  } catch (err) {
    LOG("✗ fetch failed:", err);
    return { matched: false, reason: "network_error", error: String(err) };
  }
}

function safeRespond(promise, sendResponse, fallback) {
  promise
    .then((v) => sendResponse(v))
    .catch((err) => sendResponse({ ...fallback, error: String(err) }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GE_SCAN") {
    safeRespond(postScan(msg.platform, msg.body), sendResponse, {
      matched: false,
      reason: "background_error",
    });
    return true; // async response
  }
  if (msg?.type === "GE_GET_ACTIVE_BUSINESS") {
    safeRespond(getActiveBusiness(), sendResponse, null);
    return true;
  }
});
