/**
 * WrapGuru — live chat agent for weprintwraps.com.
 *
 * INSTALL (one line, theme footer or GTM Custom HTML → All Pages):
 *   <script src="https://restyleproai.com/embeds/wpw-chat-widget.js" async data-cfasync="false"></script>
 *
 * `data-cfasync="false"` is REQUIRED, not optional — it excludes this file from
 * Cloudflare Rocket Loader, which rewrites script execution and is the usual
 * reason a third-party widget "gets blocked" on a Cloudflare site.
 *
 * ── THIS FILE MUST NOT BE ABLE TO BREAK THE HOST PAGE ──────────────────
 * Three failures have happened on this site before. Each has a structural
 * defence here; keep them if you edit this file.
 *
 *   1. "The chat covered the whole page."
 *      Everything renders inside a SHADOW ROOT. Theme and Elementor CSS cannot
 *      reach in, and nothing leaks out. The host element's own geometry is set
 *      with !important inline so a stray `div{width:100%}` cannot stretch it.
 *
 *   2. "The screen went white."
 *      Every entry point is wrapped in try/catch, and boot waits for the page
 *      to be interactive. If this widget throws, it removes itself and the page
 *      carries on. A chat bubble is never worth a white screen.
 *
 *   3. "Cloudflare blocked the script."
 *      data-cfasync="false" above. The widget also makes no cross-origin call
 *      until the visitor actually opens it and types, so nothing fires on load.
 *
 * NO API KEY IS EMBEDDED. Uploads go through wrapguru-upload-url, which mints a
 * one-shot signed URL and picks the destination path server-side.
 *
 * Kill switch: window.WPW_CHAT_DISABLED = true before this script loads.
 */
(function () {
  "use strict";

  var HOST_ID = "wpwchat-host";
  var FN = "https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/";
  var API = FN + "wpw-sales-chat";
  var UPLOAD_URL_API = FN + "wrapguru-upload-url";
  var SKEY = "wpwchat.v1";

  var ACCEPT = ".pdf,.png,.jpg,.jpeg,.psd,.ai,.eps,.tif,.tiff";
  var MAX_BYTES = 50 * 1024 * 1024;
  var MAX_UPLOADS = 5;

  var host = null;

  /** Remove ourselves entirely. Used when anything goes wrong. */
  function selfDestruct(why) {
    try {
      if (window.console && console.warn) console.warn("[WrapGuru] disabled:", why);
      if (host && host.parentNode) host.parentNode.removeChild(host);
    } catch (e) { /* nothing left to do */ }
  }

  /** Wrap any handler so a throw can never escape into the host page. */
  function safe(fn) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { selfDestruct(e && e.message); }
    };
  }

  function boot() {
    if (window.WPW_CHAT_DISABLED) return;
    if (document.getElementById(HOST_ID)) return;
    // Shadow DOM is the whole isolation strategy. Without it we would be
    // exposed to theme CSS, which is failure #1. Don't render at all rather
    // than render unisolated.
    if (!document.body || !document.body.attachShadow) return;

    var state = { open: false, busy: false, history: [], uploads: 0 };
    try {
      var saved = sessionStorage.getItem(SKEY);
      if (saved) state.history = JSON.parse(saved).slice(-20);
    } catch (e) {}
    var sessionId;
    try {
      sessionId = sessionStorage.getItem(SKEY + ".sid");
      if (!sessionId) {
        sessionId = "wc-" + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(SKEY + ".sid", sessionId);
      }
    } catch (e) { sessionId = "wc-anon"; }

    // ── Host element: fixed, small, and immune to page CSS ──────────
    host = document.createElement("div");
    host.id = HOST_ID;
    var hostCss = {
      position: "fixed", right: "18px", bottom: "18px", width: "auto", height: "auto",
      margin: "0", padding: "0", border: "0", background: "none", float: "none",
      transform: "none", "max-width": "none", "min-width": "0", "z-index": "2147483000"
    };
    for (var k in hostCss) host.style.setProperty(k, hostCss[k], "important");
    document.body.appendChild(host);

    var sr = host.attachShadow({ mode: "open" });

    var C = {
      shell: "#0f1020", head: "#0a0a14", card: "#16213e", input: "#0f3460",
      border: "rgba(139,92,246,.28)", text: "#e8eaf6", muted: "#94a3b8",
      grad: "linear-gradient(90deg,#e6007e,#7c3aed)"
    };

    sr.innerHTML =
      '<style>' +
      // :host-scoped reset — nothing inherits from the page.
      ':host{all:initial;}' +
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
      '#btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:' + C.head + ';color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;position:relative;}' +
      '#btn::after{content:"";position:absolute;inset:-3px;border-radius:50%;background:' + C.grad + ';z-index:-1;}' +
      '#btn svg{width:26px;height:26px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}' +
      // Bounded on every axis, and never taller/wider than the viewport.
      '#panel{display:none;position:fixed;right:18px;bottom:92px;width:370px;max-width:calc(100vw - 36px);height:560px;max-height:calc(100vh - 120px);background:' + C.shell + ';border:1px solid ' + C.border + ';border-radius:18px;box-shadow:0 28px 70px rgba(0,0,0,.5);overflow:hidden;flex-direction:column;}' +
      '#panel.open{display:flex;}' +
      '#head{background:' + C.head + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:relative;flex:0 0 auto;}' +
      '#head .bar{height:3px;position:absolute;left:0;right:0;top:0;background:' + C.grad + ';}' +
      '#head b{font-size:14.5px;font-weight:800;}' +
      '#head span{font-size:11.5px;color:#34d399;display:block;}' +
      '#x{margin-left:auto;background:none;border:none;color:#6b7280;font-size:20px;cursor:pointer;line-height:1;padding:4px;}' +
      '#x:hover{color:#fff;}' +
      '#msgs{flex:1 1 auto;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;min-height:0;}' +
      '.m{max-width:85%;padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;}' +
      '.m.u{align-self:flex-end;background:' + C.grad + ';color:#fff;border-bottom-right-radius:5px;}' +
      '.m.a{align-self:flex-start;background:' + C.card + ';border:1px solid ' + C.border + ';color:' + C.text + ';border-bottom-left-radius:5px;}' +
      '.m.a a{color:#60a5fa;font-weight:700;text-decoration:underline;}' +
      '.m.a a.cta{display:inline-block;margin-top:7px;background:' + C.grad + ';color:#fff;text-decoration:none;font-weight:800;font-size:13px;padding:8px 14px;border-radius:9px;}' +
      '#form{display:flex;gap:8px;padding:11px;border-top:1px solid ' + C.border + ';background:' + C.head + ';align-items:center;flex:0 0 auto;}' +
      '#clip{height:42px;width:42px;flex:0 0 42px;border:1px solid ' + C.border + ';border-radius:11px;cursor:pointer;background:' + C.input + ';color:' + C.muted + ';display:flex;align-items:center;justify-content:center;}' +
      '#clip:hover{color:#fff;}' +
      '#clip svg{width:17px;height:17px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}' +
      '#in{flex:1 1 auto;min-width:0;height:42px;border:1px solid ' + C.border + ';border-radius:11px;padding:0 12px;font-size:14px;color:' + C.text + ';background:' + C.input + ';}' +
      '#in::placeholder{color:#6b7280;}' +
      '#in:focus{outline:none;border-color:#e6007e;}' +
      '#send{height:42px;padding:0 15px;border:none;border-radius:11px;cursor:pointer;background:' + C.grad + ';color:#fff;font-weight:800;font-size:13.5px;}' +
      '#send:disabled,#clip:disabled{opacity:.5;cursor:default;}' +
      '.typing{align-self:flex-start;color:' + C.muted + ';font-size:12.5px;padding:4px 2px;}' +
      '#foot{text-align:center;font-size:10px;color:' + C.muted + ';padding:0 0 8px;background:' + C.head + ';flex:0 0 auto;}' +
      // On a phone the panel becomes a sheet, but still never the whole page.
      '@media (max-width:480px){#panel{right:8px;left:8px;width:auto;max-width:none;bottom:86px;height:min(72vh,520px);}}' +
      '</style>' +
      '<div id="panel" role="dialog" aria-label="WrapGuru chat">' +
        '<div id="head"><div class="bar"></div>' +
          '<div><b>WrapGuru</b><span>● Online · instant pricing &amp; file checks</span></div>' +
          '<button id="x" aria-label="Close chat">&times;</button>' +
        '</div>' +
        '<div id="msgs"></div>' +
        '<form id="form">' +
          '<input id="file" type="file" accept="' + ACCEPT + '" style="display:none">' +
          '<button id="clip" type="button" title="Attach artwork for a free print check" aria-label="Attach artwork">' +
            '<svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
          '</button>' +
          '<input id="in" type="text" placeholder="e.g. price 250 sq ft of 3M…" autocomplete="off">' +
          '<button id="send" type="submit">Send</button>' +
        '</form>' +
        '<div id="foot">Powered by WrapGuru · We Print Wraps</div>' +
      '</div>' +
      '<button id="btn" aria-label="Open chat"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg></button>';

    var $ = function (id) { return sr.getElementById(id); };
    var panel = $("panel"), btn = $("btn"), msgs = $("msgs"), form = $("form"),
        input = $("in"), send = $("send"), clip = $("clip"), fileIn = $("file");

    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function isCta(u) { return /add-to-cart|recreatepro/.test(u); }
    function render(s) {
      var h = esc(s);
      h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, t, u) {
        return '<a href="' + u + '"' + (isCta(u) ? ' class="cta"' : "") + ' target="_blank" rel="noopener">' + t + "</a>";
      });
      h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (_, pre, u) {
        var label = /add-to-cart/.test(u) ? "Add to cart →"
          : /recreatepro/.test(u) ? "Get a recreate →"
          : u.replace(/^https?:\/\//, "");
        return pre + '<a href="' + u + '"' + (isCta(u) ? ' class="cta"' : "") + ' target="_blank" rel="noopener">' + label + "</a>";
      });
      return h;
    }
    function addMsg(role, text) {
      var d = document.createElement("div");
      d.className = "m " + (role === "user" ? "u" : "a");
      if (role === "user") d.textContent = text; else d.innerHTML = render(text);
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function persist() {
      try { sessionStorage.setItem(SKEY, JSON.stringify(state.history.slice(-20))); } catch (e) {}
    }
    function fmtSize(b) {
      if (b < 1024) return b + " B";
      if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
      return (b / 1048576).toFixed(1) + " MB";
    }
    function setBusy(on, label) {
      state.busy = on; send.disabled = on; clip.disabled = on;
      var t = sr.getElementById("t");
      if (on) {
        if (!t) { t = document.createElement("div"); t.id = "t"; t.className = "typing"; msgs.appendChild(t); }
        t.textContent = label || "typing…";
        msgs.scrollTop = msgs.scrollHeight;
      } else if (t) { t.remove(); }
    }

    if (state.history.length) {
      state.history.forEach(function (m) { addMsg(m.role, m.content); });
    } else {
      addMsg("assistant", "Hey! I'm WrapGuru 👋 I can price printed wrap film instantly, check your print file, or help with an order. What are you working on?");
    }

    btn.addEventListener("click", safe(function () {
      state.open = !state.open;
      panel.classList.toggle("open", state.open);
      if (state.open) setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
    }));
    $("x").addEventListener("click", safe(function () {
      state.open = false; panel.classList.remove("open");
    }));

    function post(text, upload) {
      addMsg("user", text);
      state.history.push({ role: "user", content: text });
      persist();
      setBusy(true);

      var body = {
        message: text,
        session_id: sessionId,
        history: state.history.slice(-10),
        page_path: (location.pathname + location.search).slice(0, 300),
        referrer: (document.referrer || "").slice(0, 400)
      };
      if (upload) body.upload = upload;

      fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var reply = (d && (d.reply || d.response || d.message)) ||
            "Sorry — hiccup on my end. Call us at 549-622-4678 or try again.";
          addMsg("assistant", reply);
          state.history.push({ role: "assistant", content: reply });
          persist();
        })
        .catch(function () {
          addMsg("assistant", "Connection hiccup — try again, or call 549-622-4678.");
        })
        .then(function () { setBusy(false); });
    }

    form.addEventListener("submit", safe(function (e) {
      e.preventDefault();
      var text = (input.value || "").trim();
      if (!text || state.busy) return;
      input.value = "";
      post(text);
    }));

    clip.addEventListener("click", safe(function () { if (!state.busy) fileIn.click(); }));

    fileIn.addEventListener("change", safe(function () {
      var file = fileIn.files && fileIn.files[0];
      fileIn.value = "";
      if (!file || state.busy) return;

      if (state.uploads >= MAX_UPLOADS) {
        addMsg("assistant", "You've hit the upload limit for this session. Email the file to design@weprintwraps.com and the team will take it from there.");
        return;
      }
      if (file.size > MAX_BYTES) {
        addMsg("assistant", "That file is " + fmtSize(file.size) + " — over the 50MB limit. Compress it, or email it to design@weprintwraps.com.");
        return;
      }
      var ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ACCEPT.indexOf("." + ext) === -1) {
        addMsg("assistant", "I can't read ." + ext + " files. Send a PDF, AI, EPS, PNG, JPG, TIFF or PSD.");
        return;
      }

      setBusy(true, "Uploading your file…");
      fetch(UPLOAD_URL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, file_size: file.size, session_id: sessionId })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.signed_url) throw new Error((d && d.error) || "no upload url");
          return fetch(d.signed_url, { method: "PUT", body: file }).then(function (up) {
            if (!up.ok) throw new Error("upload failed " + up.status);
            return d.path;
          });
        })
        .then(function (path) {
          state.uploads++;
          setBusy(false);
          post("I've attached my artwork: " + file.name + " (" + fmtSize(file.size) + "). Can you check if it will print?",
               { path: path, name: file.name, size: file.size });
        })
        .catch(function () {
          setBusy(false);
          addMsg("assistant", "That upload didn't go through. Try again, or email the file to design@weprintwraps.com.");
        });
    }));
  }

  // Boot only once the page is usable, and never let boot itself throw.
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", safe(boot));
    } else {
      safe(boot)();
    }
  } catch (e) { selfDestruct(e && e.message); }
})();
