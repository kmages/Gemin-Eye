(function() {
  if (window.__geminEyeActive) return;
  window.__geminEyeActive = true;

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
  banner.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#4338ca,#6d28d9);color:white;text-align:center;padding:10px 20px;z-index:99999;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:8px;';

  var counter = document.createElement('span');
  counter.id = 'gemin-eye-count';
  counter.textContent = '0 posts scanned';
  counter.style.cssText = 'font-weight:normal;opacity:0.85;font-size:13px;';

  var closeBtn = document.createElement('span');
  closeBtn.textContent = 'X';
  closeBtn.style.cssText = 'position:absolute;right:16px;cursor:pointer;font-size:16px;opacity:0.7;';
  closeBtn.onclick = function() {
    banner.remove();
    window.__geminEyeActive = false;
    clearInterval(scanInterval);
  };

  banner.innerHTML = 'Gemin-Eye: Scanning this feed... ';
  banner.appendChild(counter);
  banner.appendChild(closeBtn);
  document.body.appendChild(banner);

  var seenPosts = {};
  var scannedCount = 0;
  var sentCount = 0;

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
      if (data.matched) {
        sentCount++;
        element.style.outline = '3px solid #6d28d9';
        element.style.outlineOffset = '4px';
        element.style.borderRadius = '4px';
      }
    }).catch(function() {});

    counter.textContent = scannedCount + ' scanned, ' + sentCount + ' leads';
  }

  function scan() {
    var posts = extractPosts();
    posts.forEach(function(p) {
      sendPost(p.text, p.element);
    });
  }

  scan();
  var scanInterval = setInterval(scan, 3000);
})();
