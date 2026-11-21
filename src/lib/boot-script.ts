/**
 * Tiny render-blocking script, inlined in <head> before any app code (see
 * src/app/layout.tsx). Plain ES5, no dependencies — it has to work exactly
 * when the app itself does not.
 *
 * 1. RECOVER FROM A DEAD PAGE. After a deploy, a phone that kept the shop open
 *    (or the installed app) can ask for script files of the previous version
 *    that no longer exist. The page then shows but nothing responds — "kabhi
 *    kabhi rook jata hai, 2–4 baar band karne pe chalta hai". When one of OUR
 *    scripts fails to load, reload once (never more than once per 30 s, so it
 *    cannot loop).
 *
 * 2. NO LOST TAPS. Until the app has started (a few seconds on a budget phone
 *    on 4G), buttons ignore taps — "pehle to touch nahi hota". A tap on a
 *    button in that window is remembered, a thin working bar shows at once,
 *    and ActivityBar replays the tap the moment the app is ready. Links need
 *    none of this: they navigate natively. Once React itself is listening, it
 *    handles early taps on its own and this stays out of the way (no double
 *    taps).
 *
 * 3. TELL US. Both cases send a one-line beacon to /api/client-log so they
 *    show up in the server logs instead of only in a WhatsApp voice note.
 */
export const BOOT_SCRIPT = `(function(){try{
var w=window,d=document,h=d.documentElement;
function log(kind,reason){try{var b=JSON.stringify({kind:kind,reason:String(reason).slice(0,300),path:location.pathname+location.search,ua:navigator.userAgent.slice(0,160)});if(navigator.sendBeacon){navigator.sendBeacon('/api/client-log',b)}else{fetch('/api/client-log',{method:'POST',body:b,keepalive:true})}}catch(e){}}
w.__mdLog=log;
function recover(reason){try{var k='md-recover-at',last=+(sessionStorage.getItem(k)||0);if(Date.now()-last<30000){log('stuck',reason);return}sessionStorage.setItem(k,String(Date.now()))}catch(e){}log('reload',reason);location.reload()}
w.addEventListener('error',function(e){var t=e&&e.target;if(t&&t.tagName==='SCRIPT'&&/\\/_next\\/static\\//.test(t.src||'')){recover('script '+t.src)}},true);
w.addEventListener('unhandledrejection',function(e){var r=e&&e.reason,m=r?((r.name||'')+' '+(r.message||r)):'';if(/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(m)){recover(m)}});
function reactListening(){var ks=Object.keys(d);for(var i=0;i<ks.length;i++){if(ks[i].indexOf('__reactContainer$')===0)return true}return false}
d.addEventListener('click',function(e){if(w.__mdHydrated||reactListening())return;var t=e.target&&e.target.closest?e.target.closest('button,[role="button"],summary'):null;if(!t||t.disabled)return;if(t.type==='submit'&&t.form)return;w.__mdTap={el:t,at:Date.now()};h.setAttribute('data-md-wait','1');setTimeout(function(){h.removeAttribute('data-md-wait')},12000)},true);
}catch(e){}})();`;

/** The pre-start working bar (pure CSS — no app code has run yet). */
export const BOOT_STYLE = `html[data-md-wait]::before{content:"";position:fixed;left:0;right:0;top:env(safe-area-inset-top,0);height:3px;z-index:2147483000;background:linear-gradient(90deg,transparent,var(--primary,#16a34a),transparent);background-size:50% 100%;background-repeat:no-repeat;animation:md-wait 1s linear infinite}@keyframes md-wait{from{background-position:-50% 0}to{background-position:150% 0}}`;
