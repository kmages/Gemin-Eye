import crypto from "crypto";

const TOKEN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function getCurrentWindow(): number {
  return Math.floor(Date.now() / TOKEN_WINDOW_MS);
}

export function generateScanToken(chatId: string, businessId: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET environment variable is required for token generation");
  const window = getCurrentWindow();
  return crypto.createHmac("sha256", secret).update(`${chatId}:${businessId}:${window}`).digest("hex").slice(0, 32);
}

export function validateScanToken(chatId: string, businessId: number, token: string): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const currentWindow = getCurrentWindow();
  for (const w of [currentWindow, currentWindow - 1]) {
    const expected = crypto.createHmac("sha256", secret).update(`${chatId}:${businessId}:${w}`).digest("hex").slice(0, 32);
    if (token === expected) return true;
  }
  return false;
}

const CONNECT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getConnectWindow(): number {
  return Math.floor(Date.now() / CONNECT_WINDOW_MS);
}

export function generateConnectToken(businessId: number, userId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET required");
  const w = getConnectWindow();
  return crypto.createHmac("sha256", secret).update(`connect:${businessId}:${userId}:${w}`).digest("hex").slice(0, 16);
}

export function validateConnectTokenForOwner(businessId: number, ownerUserId: string, token: string): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const cw = getConnectWindow();
  for (const w of [cw, cw - 1]) {
    const expected = crypto.createHmac("sha256", secret).update(`connect:${businessId}:${ownerUserId}:${w}`).digest("hex").slice(0, 16);
    if (token === expected) return true;
  }
  return false;
}

function buildRelaySetup(baseUrlVar: string, apiVar: string): string {
  return `var relayId='ge_'+Math.random().toString(36).slice(2,8);` +
    `var relayUrl=${baseUrlVar}+'/relay.html';` +
    `var relay=window.open(relayUrl,relayId,'width=300,height=120,top=50,right=50');` +
    `if(!relay||relay.closed){alert('Please allow popups for this page, then try again.');window.__geminEyeActive=false;window.__geminEyeLiActive=false;return}` +
    `var msgCounter=0;var pendingCallbacks={};` +
    `window.addEventListener('message',function(ev){if(!ev.data||ev.data.type!=='gemin-eye-result')return;var cb=pendingCallbacks[ev.data.msgId];if(cb){delete pendingCallbacks[ev.data.msgId];cb(ev.data.data)}});` +
    `function sendToApi(payload,onSuccess,onFail){` +
      `var id='m'+(++msgCounter);` +
      `pendingCallbacks[id]=function(d){onSuccess(d)};` +
      `setTimeout(function(){if(pendingCallbacks[id]){delete pendingCallbacks[id];onFail('timeout')}},30000);` +
      `try{relay.postMessage({type:'gemin-eye-scan',apiUrl:${apiVar},payload:payload,msgId:id},'*')}catch(e){delete pendingCallbacks[id];onFail('relay_closed')}` +
    `}`;
}

export function generateLinkedInBookmarkletCode(baseUrl: string, chatId: string, businessId: number, token: string): string {
  const apiUrl = `${baseUrl}/api/li-scan`;
  const relaySetup = buildRelaySetup('BASE', 'API');
  const code = `javascript:void((function(){` +
    `if(window.__geminEyeLiActive){alert('Gemin-Eye is already scanning this page. Click X on the banner to stop first.');return}` +
    `window.__geminEyeLiActive=true;` +
    `var CID='${chatId}',BID=${businessId},TOK='${token}',API='${apiUrl}',BASE='${baseUrl}';` +
    `var seenPosts={},scannedCount=0,sentCount=0,pendingCount=0,failCount=0,autoScrolling=true,scrollsDone=0,maxScrolls=150,noNewCount=0;` +
    `${relaySetup}` +
    `var banner=document.createElement('div');banner.id='gemin-eye-li-banner';` +
    `banner.style.cssText='position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#0077B5,#00A0DC);color:white;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:10px;';` +
    `var counter=document.createElement('span');counter.style.cssText='font-weight:normal;opacity:0.85;font-size:13px;';counter.textContent='0 scanned';` +
    `function updateCounter(){var t=scannedCount+' scanned, '+sentCount+' leads';if(failCount>0)t+=', '+failCount+' failed';if(pendingCount>0)t+=' ('+pendingCount+' checking...)';if(!autoScrolling&&scrollsDone>=maxScrolls)t+=' - Done';counter.textContent=t}` +
    `var pauseBtn=document.createElement('span');pauseBtn.textContent='Pause';` +
    `pauseBtn.style.cssText='cursor:pointer;background:rgba(255,255,255,0.25);padding:4px 14px;border-radius:4px;font-size:12px;font-weight:700;';` +
    `pauseBtn.onclick=function(){autoScrolling=!autoScrolling;pauseBtn.textContent=autoScrolling?'Pause':'Resume'};` +
    `var closeBtn=document.createElement('span');closeBtn.textContent='[X] Close';` +
    `closeBtn.style.cssText='cursor:pointer;background:rgba(255,0,0,0.35);padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;margin-left:4px;';` +
    `closeBtn.onclick=function(){banner.remove();window.__geminEyeLiActive=false;autoScrolling=false;clearInterval(si);clearInterval(scrollInterval);try{relay.close()}catch(e){}};` +
    `banner.appendChild(document.createTextNode('Gemin-Eye LinkedIn '));banner.appendChild(counter);banner.appendChild(pauseBtn);banner.appendChild(closeBtn);` +
    `document.body.appendChild(banner);` +
    `function extractPosts(){var found=[];var els=document.querySelectorAll('.feed-shared-update-v2__description,.feed-shared-inline-show-more-text,.feed-shared-text,.update-components-text,span.break-words');` +
    `els.forEach(function(el){var t=(el.innerText||'').trim();if(t.length<25||t.length>5000||seenPosts[t])return;found.push({text:t,element:el})});return found}` +
    `function sendPost(text,el){seenPosts[text]=true;scannedCount++;pendingCount++;updateCounter();` +
    `var authorName='';try{var card=el.closest('.feed-shared-update-v2');if(card){var nameEl=card.querySelector('.update-components-actor__name span[aria-hidden],.feed-shared-actor__name span');if(nameEl)authorName=nameEl.innerText||''}}catch(e){}` +
    `var payload={chatId:CID,businessId:BID,token:TOK,postText:text,authorName:authorName||'LinkedIn user',pageUrl:window.location.href};` +
    `sendToApi(payload,function(d){pendingCount--;if(d.matched){sentCount++;el.style.outline='3px solid #0077B5';el.style.outlineOffset='4px';el.style.borderRadius='4px'}updateCounter()},function(reason){pendingCount--;failCount++;updateCounter()})}` +
    `function scan(){if(document.hidden)return;var posts=extractPosts();if(posts.length===0)noNewCount++;else noNewCount=0;posts.forEach(function(p){if(scannedCount>=500)return;sendPost(p.text,p.element)});if(scannedCount>=500||noNewCount>=20){autoScrolling=false;clearInterval(scrollInterval);updateCounter()}}` +
    `document.addEventListener('visibilitychange',function(){if(!document.hidden){noNewCount=0;if(scrollsDone<maxScrolls&&scannedCount<500){autoScrolling=true;pauseBtn.textContent='Pause'}}});` +
    `scan();var si=setInterval(scan,2000);` +
    `var scrollInterval=setInterval(function(){if(!autoScrolling||document.hidden)return;scrollsDone++;if(scrollsDone>=maxScrolls){autoScrolling=false;clearInterval(scrollInterval);updateCounter();return}window.scrollBy({top:600,behavior:'smooth'})},1500)` +
    `})())`;
  return code;
}

export function generateBookmarkletCode(baseUrl: string, chatId: string, businessId: number, token: string): string {
  const apiUrl = `${baseUrl}/api/fb-scan`;
  const relaySetup = buildRelaySetup('BASE', 'API');
  const code = `javascript:void((function(){` +
    `if(window.__geminEyeActive){alert('Gemin-Eye is already scanning this page. Click X on the banner to stop first.');return}` +
    `window.__geminEyeActive=true;` +
    `var CID='${chatId}',BID=${businessId},TOK='${token}',API='${apiUrl}',BASE='${baseUrl}';` +
    `var seenPosts={},scannedCount=0,sentCount=0,pendingCount=0,failCount=0,autoScrolling=true,scrollsDone=0,maxScrolls=150,noNewCount=0;` +
    `${relaySetup}` +
    `var banner=document.createElement('div');banner.id='gemin-eye-banner';` +
    `banner.style.cssText='position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#4338ca,#6d28d9);color:white;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:10px;';` +
    `var counter=document.createElement('span');counter.style.cssText='font-weight:normal;opacity:0.85;font-size:13px;';counter.textContent='0 scanned';` +
    `function updateCounter(){var t=scannedCount+' scanned, '+sentCount+' leads';if(failCount>0)t+=', '+failCount+' failed';if(pendingCount>0)t+=' ('+pendingCount+' checking...)';if(!autoScrolling&&scrollsDone>=maxScrolls)t+=' - Done';counter.textContent=t}` +
    `var pauseBtn=document.createElement('span');pauseBtn.textContent='Pause';` +
    `pauseBtn.style.cssText='cursor:pointer;background:rgba(255,255,255,0.25);padding:4px 14px;border-radius:4px;font-size:12px;font-weight:700;';` +
    `pauseBtn.onclick=function(){autoScrolling=!autoScrolling;pauseBtn.textContent=autoScrolling?'Pause':'Resume'};` +
    `var closeBtn=document.createElement('span');closeBtn.textContent='[X] Close';` +
    `closeBtn.style.cssText='cursor:pointer;background:rgba(255,0,0,0.35);padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;margin-left:4px;';` +
    `closeBtn.onclick=function(){banner.remove();window.__geminEyeActive=false;autoScrolling=false;clearInterval(si);clearInterval(scrollInterval);try{relay.close()}catch(e){}};` +
    `banner.appendChild(document.createTextNode('Gemin-Eye '));banner.appendChild(counter);banner.appendChild(pauseBtn);banner.appendChild(closeBtn);` +
    `document.body.appendChild(banner);` +
    `function extractPosts(){var found=[];var els=document.querySelectorAll('div[dir="auto"]');` +
    `els.forEach(function(el){var t=(el.innerText||'').trim();if(t.length<25||t.length>5000||seenPosts[t])return;var a=el.closest('a');if(a&&a.href&&a.href.indexOf('/comment')===-1)return;found.push({text:t,element:el})});return found}` +
    `function getPostAge(el){try{var container=el.closest('[role="article"]')||el.closest('.x1yztbdb');if(!container)container=el.parentElement;var rp=/^\\d+[smhdwy]$/,rl=/^(just now|yesterday|\\d+\\s+(min|minute|hour|hr|day|week|month|mo|year|yr)s?\\s+ago)$/i,rd=/^[A-Z][a-z]+\\s+\\d{1,2}(,?\\s+\\d{4})?/,rn=/^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}$/;function isTs(t){t=t.trim();return rp.test(t)||rl.test(t)||rd.test(t)||rn.test(t)}for(var i=0;i<6&&container;i++){var links=container.querySelectorAll('a[href*="/posts/"],a[href*="/permalink/"],a[href*="comment_id"],a[role="link"]');for(var j=0;j<links.length;j++){var lt=(links[j].innerText||'').trim();if(isTs(lt))return lt;var al=links[j].getAttribute('aria-label')||'';if(isTs(al))return al.trim()}var els2=container.querySelectorAll('abbr,time,span[id]');for(var k=0;k<els2.length;k++){var at=(els2[k].innerText||'').trim();if(isTs(at))return at;var ti=els2[k].getAttribute('title')||'';if(isTs(ti))return ti.trim();var dt=els2[k].getAttribute('datetime')||'';if(dt){try{var dd=new Date(dt);if(!isNaN(dd.getTime())){var diff=Date.now()-dd.getTime();var hrs=Math.floor(diff/3600000);if(hrs<1)return'just now';if(hrs<24)return hrs+'h';var days=Math.floor(hrs/24);if(days<7)return days+'d';var wks=Math.floor(days/7);if(wks<5)return wks+'w';return Math.floor(days/30)+'mo'}}catch(e){}}}container=container.parentElement}}catch(e){}return''}` +
    `function sendPost(text,el){seenPosts[text]=true;scannedCount++;pendingCount++;updateCounter();` +
    `var postAge=getPostAge(el);` +
    `var groupName='';var h1=document.querySelector('h1');if(h1)groupName=h1.innerText||'';if(!groupName){var titleEl=document.querySelector('[role="banner"] a[href*="/groups/"]');if(titleEl)groupName=titleEl.innerText||''}` +
    `var payload={chatId:CID,businessId:BID,token:TOK,postText:text,postAge:postAge,groupName:groupName||document.title||'Facebook Group',pageUrl:window.location.href};` +
    `sendToApi(payload,function(d){pendingCount--;if(d.matched){if(d.reason==='post_too_old'){el.style.outline='2px dashed #999';el.style.outlineOffset='4px';el.style.borderRadius='4px'}else{sentCount++;el.style.outline='3px solid #6d28d9';el.style.outlineOffset='4px';el.style.borderRadius='4px'}}updateCounter()},function(reason){pendingCount--;failCount++;updateCounter()})}` +
    `function scan(){if(document.hidden)return;var posts=extractPosts();if(posts.length===0)noNewCount++;else noNewCount=0;posts.forEach(function(p){if(scannedCount>=500)return;sendPost(p.text,p.element)});if(scannedCount>=500||noNewCount>=20){autoScrolling=false;clearInterval(scrollInterval);updateCounter()}}` +
    `document.addEventListener('visibilitychange',function(){if(!document.hidden){noNewCount=0;if(scrollsDone<maxScrolls&&scannedCount<500){autoScrolling=true;pauseBtn.textContent='Pause'}}});` +
    `scan();var si=setInterval(scan,2000);` +
    `var scrollInterval=setInterval(function(){if(!autoScrolling||document.hidden)return;scrollsDone++;if(scrollsDone>=maxScrolls){autoScrolling=false;clearInterval(scrollInterval);updateCounter();return}window.scrollBy({top:600,behavior:'smooth'})},1500)` +
    `})())`;
  return code;
}

export function getAppBaseUrl(): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) return `https://${replitDomains.split(",")[0].trim()}`;
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDevDomain) return `https://${replitDevDomain}`;
  const replSlug = process.env.REPL_SLUG;
  const replOwner = process.env.REPL_OWNER;
  if (replSlug && replOwner) return `https://${replSlug}.${replOwner}.repl.co`;
  return "https://gemin-eye.com";
}
