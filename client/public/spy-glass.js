(function() {
  if (window.__geminEyeActive) return;
  window.__geminEyeActive = true;

  var MAX_POSTS = 500;
  var SCROLL_DELAY_MS = 1500;
  var SCAN_INTERVAL_MS = 2000;

  var params = {};
  var scripts = document.getElementsByTagName('script');
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].src || '';
    if (src.indexOf('spy-glass.js') !== -1) {
      var url = new URL(src);
      params.cid = url.searchParams.get('cid') || '';
      params.bid = url.searchParams.get('bid') || '';
      params.tok = url.searchParams.get('tok') || '';
      break;
    }
  }

  if (!params.cid || !params.bid || !params.tok) {
    alert('Gemin-Eye: Missing configuration. Please re-run setup with /setup in the bot.');
    return;
  }

  var API_URL = (function() {
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('spy-glass.js') !== -1) {
        var u = new URL(src);
        return u.origin + '/api/fb-scan';
      }
    }
    return '/api/fb-scan';
  })();

  var banner = document.createElement('div');
  banner.id = 'gemin-eye-banner';
  banner.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#4338ca,#6d28d9);color:white;text-align:center;padding:10px 20px;z-index:99999;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:12px;';

  var counter = document.createElement('span');
  counter.id = 'gemin-eye-count';
  counter.textContent = '0 scanned';
  counter.style.cssText = 'font-weight:normal;opacity:0.85;font-size:13px;';

  var stopBtn = document.createElement('span');
  stopBtn.textContent = 'Stop';
  stopBtn.style.cssText = 'cursor:pointer;background:rgba(255,255,255,0.2);padding:3px 12px;border-radius:4px;font-size:12px;font-weight:600;';

  var closeBtn = document.createElement('span');
  closeBtn.textContent = 'X';
  closeBtn.style.cssText = 'position:absolute;right:16px;cursor:pointer;font-size:16px;opacity:0.7;';

  var seenPosts = {};
  var scannedCount = 0;
  var sentCount = 0;
  var pendingCount = 0;
  var running = true;
  var scrollTimer = null;
  var scanInterval = null;
  var noNewPostsCount = 0;

  function cleanup() {
    running = false;
    window.__geminEyeActive = false;
    if (scanInterval) clearInterval(scanInterval);
    if (scrollTimer) clearTimeout(scrollTimer);
    banner.remove();
  }

  function stopScanning() {
    running = false;
    if (scanInterval) clearInterval(scanInterval);
    if (scrollTimer) clearTimeout(scrollTimer);
    stopBtn.textContent = 'Stopped';
    stopBtn.style.opacity = '0.5';
    stopBtn.style.cursor = 'default';
    updateCounter();
  }

  function updateCounter() {
    var text = scannedCount + ' scanned, ' + sentCount + ' leads';
    if (pendingCount > 0) text += ' (' + pendingCount + ' checking...)';
    if (!running) text += ' - Done';
    counter.textContent = text;
  }

  closeBtn.onclick = cleanup;
  stopBtn.onclick = function() {
    if (running) stopScanning();
  };

  banner.innerHTML = '';
  var label = document.createElement('span');
  label.textContent = 'Gemin-Eye: Auto-scanning...';
  banner.appendChild(label);
  banner.appendChild(counter);
  banner.appendChild(stopBtn);
  banner.appendChild(closeBtn);
  document.body.appendChild(banner);

  function extractPosts() {
    var found = [];
    var candidates = document.querySelectorAll('div[dir="auto"]');
    candidates.forEach(function(el) {
      var text = (el.innerText || '').trim();
      if (text.length < 25) return;
      if (text.length > 5000) return;
      if (seenPosts[text]) return;

      var parentLink = el.closest('a');
      if (parentLink && parentLink.href && parentLink.href.indexOf('/comment') === -1) return;

      found.push({ text: text, element: el });
    });
    return found;
  }

  function sendPost(postText, element) {
    seenPosts[postText] = true;
    scannedCount++;
    pendingCount++;
    updateCounter();

    var groupName = '';
    var h1 = document.querySelector('h1');
    if (h1) groupName = h1.innerText || '';
    if (!groupName) {
      var titleEl = document.querySelector('[role="banner"] a[href*="/groups/"]');
      if (titleEl) groupName = titleEl.innerText || '';
    }

    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: params.cid,
        businessId: parseInt(params.bid, 10),
        token: params.tok,
        postText: postText,
        groupName: groupName || document.title || 'Facebook Group',
        pageUrl: window.location.href
      })
    }).then(function(res) {
      return res.json();
    }).then(function(data) {
      pendingCount--;
      if (data.matched) {
        sentCount++;
        element.style.outline = '3px solid #6d28d9';
        element.style.outlineOffset = '4px';
        element.style.borderRadius = '4px';
      }
      updateCounter();
    }).catch(function() {
      pendingCount--;
      updateCounter();
    });
  }

  function scan() {
    if (!running) return;
    var posts = extractPosts();

    if (posts.length === 0) {
      noNewPostsCount++;
    } else {
      noNewPostsCount = 0;
    }

    posts.forEach(function(p) {
      if (scannedCount >= MAX_POSTS) return;
      sendPost(p.text, p.element);
    });

    if (scannedCount >= MAX_POSTS) {
      stopScanning();
      return;
    }

    if (noNewPostsCount >= 10) {
      stopScanning();
      return;
    }
  }

  function autoScroll() {
    if (!running) return;
    window.scrollBy({ top: 600, behavior: 'smooth' });
    scrollTimer = setTimeout(autoScroll, SCROLL_DELAY_MS);
  }

  scan();
  scanInterval = setInterval(scan, SCAN_INTERVAL_MS);
  scrollTimer = setTimeout(autoScroll, SCROLL_DELAY_MS);
})();
