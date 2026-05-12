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

async function postScan(platform, body) {
  const biz = await getActiveBusiness();
  if (!biz) {
    return { matched: false, reason: "extension_not_configured" };
  }
  const url = `${biz.baseUrl.replace(/\/$/, "")}/api/${platform === "facebook" ? "fb-scan" : "li-scan"}`;
  const payload = {
    chatId: biz.chatId,
    businessId: biz.businessId,
    token: biz.token,
    ...body,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    return { matched: false, reason: "network_error", error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GE_SCAN") {
    postScan(msg.platform, msg.body).then(sendResponse);
    return true; // async response
  }
  if (msg?.type === "GE_GET_ACTIVE_BUSINESS") {
    getActiveBusiness().then(sendResponse);
    return true;
  }
});
