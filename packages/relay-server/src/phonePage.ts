// Drora Relay Server · 自建手机页（R2，specs/mobile-relay-server.md §7）。
// terminal 角色接入 relay：auth_init(role:"terminal") → HMAC 挑战应答 → matched。
// 数据面 = drora-page-request/response 应用帧（v1 动作帧 → 桌面 Host 服务调用）。
// 纯 HTTP 部署下 crypto.subtle 不可用，proof 用内嵌纯 JS HMAC-SHA256（常量独立导出，
// 由 test/phonePageCrypto.test.ts 对照 node:crypto 与 RFC 4231 向量校验）。

/** 纯 JS HMAC-SHA256 + base64url（页面内联执行；不依赖 window，可在 node 校验）。 */
export const PHONE_PAGE_CRYPTO_JS = `
var __shaK = (function () {
  var primes = [];
  var n = 2;
  while (primes.length < 64) {
    var isP = true;
    for (var d = 2; d * d <= n; d++) { if (n % d === 0) { isP = false; break; } }
    if (isP) primes.push(n);
    n += 1;
  }
  return primes.map(function (p) { return ((Math.cbrt(p) % 1) * 4294967296) | 0; });
})();
function __strBytes(s) {
  var out = [];
  var enc = encodeURIComponent(s);
  for (var i = 0; i < enc.length; i += 1) {
    if (enc[i] === "%") { out.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2; }
    else { out.push(enc.charCodeAt(i)); }
  }
  return out;
}
function __sha256Bytes(bytes) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var l = bytes.length;
  var bits = l * 8;
  var msg = bytes.concat([0x80]);
  while (msg.length % 64 !== 56) msg.push(0);
  var hi = Math.floor(bits / 4294967296);
  var lo = bits % 4294967296;
  msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  msg.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  var w = new Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    for (var t = 0; t < 16; t += 1) {
      w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) | (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) | 0;
    }
    for (var t2 = 16; t2 < 64; t2 += 1) {
      var s0 = ((w[t2 - 15] >>> 7) | (w[t2 - 15] << 25)) ^ ((w[t2 - 15] >>> 18) | (w[t2 - 15] << 14)) ^ (w[t2 - 15] >>> 3);
      var s1 = ((w[t2 - 2] >>> 17) | (w[t2 - 2] << 15)) ^ ((w[t2 - 2] >>> 19) | (w[t2 - 2] << 13)) ^ (w[t2 - 2] >>> 10);
      w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) | 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var t3 = 0; t3 < 64; t3 += 1) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var tt1 = (h + S1 + ch + __shaK[t3] + w[t3]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var tt2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + tt1) | 0; d = c; c = b; b = a; a = (tt1 + tt2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = [];
  for (var i = 0; i < 8; i += 1) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
  return out;
}
function __hmacSha256Bytes(keyStr, messageStr) {
  var key = __strBytes(keyStr);
  if (key.length > 64) key = __sha256Bytes(key);
  var outer = [];
  var inner = [];
  for (var i = 0; i < 64; i += 1) {
    var b = key[i] || 0;
    outer.push(b ^ 0x5c);
    inner.push(b ^ 0x36);
  }
  return __sha256Bytes(outer.concat(__sha256Bytes(inner.concat(__strBytes(messageStr)))));
}
function __bytesB64url(bytes) {
  var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = bytes[i + 1];
    var b2 = bytes[i + 2];
    out += alpha[b0 >> 2];
    out += alpha[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    if (b1 === undefined) break;
    out += alpha[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    if (b2 === undefined) break;
    out += alpha[b2 & 63];
  }
  return out;
}
function computeProof(passHash, nonce, deviceSid) {
  return __bytesB64url(__hmacSha256Bytes(passHash, nonce + "|terminal|" + deviceSid));
}
`;

export const PHONE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Drora</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0e0f11; color: #e8e8e6; font-family: system-ui, sans-serif; }
  header { padding: 12px 16px; border-bottom: 1px solid #2a2b2e; display: flex; align-items: center; gap: 8px; position: sticky; top: 0; background: #0e0f11; z-index: 2; }
  header h1 { font-size: 16px; margin: 0; flex: 1; }
  main { padding: 12px 16px 40px; }
  .card { background: #17181b; border: 1px solid #2a2b2e; border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .task { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 2px; border-bottom: 1px solid #232427; cursor: pointer; }
  .task:last-child { border-bottom: 0; }
  .title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; flex-shrink: 0; }
  .badge.running { background: #2b3a2e; color: #7ad07a; }
  .badge.idle { background: #26272b; color: #9a9ba0; }
  .msg { padding: 8px 10px; border-radius: 10px; margin: 6px 0; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: #24304a; }
  .msg.assistant { background: #1d1e21; }
  input, textarea, button { font: inherit; }
  textarea { width: 100%; min-height: 72px; background: #17181b; color: inherit; border: 1px solid #2a2b2e; border-radius: 10px; padding: 10px; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  button { flex: 1; padding: 10px; border-radius: 10px; border: 1px solid #2a2b2e; background: #24304a; color: inherit; cursor: pointer; }
  button.secondary { background: #17181b; }
  .hidden { display: none; }
  .tip { color: #8a8b8f; font-size: 13px; }
  .perm { border-color: #4a3a24; background: #241f17; }
  .perm .title { font-weight: 600; margin-bottom: 4px; }
</style>
</head>
<body>
<header><h1>Drora</h1><span id="conn" class="tip">连接中…</span></header>
<main>
  <section id="unpaired" class="hidden"><p class="tip" id="unpairedText">配对链接无效，请在桌面端重新生成二维码。</p></section>
  <section id="tasks" class="hidden"><div class="card" id="taskList"></div></section>
  <section id="chat" class="hidden">
    <div id="perms"></div>
    <div class="card">
      <div class="task" id="back"><span class="title">← 返回任务列表</span></div>
      <div id="timeline"></div>
    </div>
    <textarea id="input" placeholder="输入要发送给 Agent 的内容…"></textarea>
    <div class="row"><button id="send">发送</button><button id="stop" class="secondary">停止</button></div>
  </section>
</main>
<script>
${PHONE_PAGE_CRYPTO_JS}
</script>
<script>
var ws = null;
var terminal = false;
var retryTimer = null;
var currentTaskId = null;
var reqSeq = 0;

var params = new URLSearchParams(location.search);
var deviceSid = params.get("sid") || "";
var passHash = params.get("hash") || "";

function el(id) { return document.getElementById(id); }
function show(id) {
  for (var s of ["unpaired", "tasks", "chat"]) el(s).classList.toggle("hidden", s !== id);
}
function esc(text) {
  var d = document.createElement("div");
  d.textContent = text == null ? "" : String(text);
  return d.innerHTML;
}
function setConn(text) { el("conn").textContent = text; }

function markTerminal(text) {
  terminal = true;
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  el("unpairedText").textContent = text;
  setConn(text);
  show("unpaired");
}

function connect() {
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host + "/ws");
  ws.onopen = function () {
    ws.send(JSON.stringify({ type: "auth_init", role: "terminal", device_sid: deviceSid, client_ts: Date.now() }));
  };
  ws.onmessage = function (e) {
    var msg = JSON.parse(e.data);
    if (msg.type === "auth_challenge") {
      ws.send(JSON.stringify({ type: "auth_response", device_sid: deviceSid, proof: computeProof(passHash, msg.nonce, deviceSid), client_ts: Date.now() }));
      return;
    }
    if (msg.type === "auth_ack") {
      setConn("已连接");
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      onReady();
      return;
    }
    if (msg.type === "error") {
      if (msg.code === "KICKED") { markTerminal("此配对会话已被其他页面接管，请在桌面端重新扫码。"); return; }
      if (msg.code === "DEVICE_OFFLINE") { markTerminal("桌面端已离线，请在桌面端重新开启远程控制。"); return; }
      if (msg.code === "AUTH_FAILED") { markTerminal("配对链接无效，请在桌面端重新生成二维码。"); return; }
      setConn("服务错误：" + (msg.message || msg.code));
      return;
    }
    if (msg.type === "data" && msg.payload) { handle(msg.payload); }
  };
  ws.onclose = function () {
    setConn("已断开，重连中…");
    ws = null;
    if (terminal || retryTimer) { return; }
    retryTimer = setInterval(function () { if (deviceSid && passHash) { connect(); } }, 2000);
  };
}

// v1 动作帧 → relay data 信封（drora-page-request）；应答经 handle(frame) 全局分发。
function sendFrame(frame) {
  if (!ws || ws.readyState !== 1) return;
  reqSeq += 1;
  ws.send(JSON.stringify({
    type: "data",
    client_ts: Date.now(),
    payload: { zcode_type: "drora-page-request", requestId: "p" + reqSeq, frame: frame },
  }));
}

function onReady() {
  if (currentTaskId) { show("chat"); requestTimeline(); }
  else { show("tasks"); requestList(); }
}

function requestList() { sendFrame({ type: "list" }); }
function requestTimeline() { if (currentTaskId) sendFrame({ type: "open", taskId: currentTaskId }); }

var lastSeq = 0;
var eventBusy = false;
var pendingPerms = {};

function requestEvents() {
  if (!ws || ws.readyState !== 1 || !currentTaskId || eventBusy) return;
  eventBusy = true;
  sendFrame({ type: "events", taskId: currentTaskId, afterSeq: lastSeq });
}

function applyEvents(frame) {
  eventBusy = false;
  if (frame.taskId !== currentTaskId) return;
  var events = frame.events || [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (typeof ev.seq === "number" && ev.seq > lastSeq) { lastSeq = ev.seq; }
    var p = ev.payload || {};
    if (ev.type === "permission.requested") {
      var key = p.requestId || p.toolCallId;
      pendingPerms[key] = { requestId: key, toolName: p.toolName || "tool", reason: p.reason || "", options: p.options || [] };
    } else if (ev.type === "permission.resolved") {
      delete pendingPerms[p.requestId || p.toolCallId];
    }
  }
  renderPerms();
}

function renderPerms() {
  var box = el("perms");
  box.innerHTML = "";
  var keys = Object.keys(pendingPerms);
  for (var i = 0; i < keys.length; i++) {
    var perm = pendingPerms[keys[i]];
    var card = document.createElement("div");
    card.className = "card perm";
    var html = '<div class="title">🔐 ' + esc(perm.toolName) + '</div>';
    if (perm.reason) { html += '<p class="tip">' + esc(perm.reason) + "</p>"; }
    var options = perm.options.length ? perm.options : [
      { optionId: "allow", name: "允许", response: { decision: "allow" } },
      { optionId: "deny", name: "拒绝", response: { decision: "deny" } }
    ];
    html += '<div class="row">';
    for (var k = 0; k < options.length; k++) {
      var opt = options[k];
      html += '<button data-perm="' + esc(perm.requestId) + '" data-opt="' + esc(opt.optionId) +
        '" data-decision="' + esc(opt.response && opt.response.decision ? opt.response.decision : "allow") + '">' + esc(opt.name) + "</button>";
    }
    html += "</div>";
    card.innerHTML = html;
    box.appendChild(card);
  }
  var buttons = box.querySelectorAll("button");
  for (var b = 0; b < buttons.length; b++) {
    buttons[b].onclick = function () {
      sendFrame({
        type: "permission", taskId: currentTaskId,
        requestId: this.getAttribute("data-perm"),
        optionId: this.getAttribute("data-opt"),
        decision: this.getAttribute("data-decision")
      });
      delete pendingPerms[this.getAttribute("data-perm")];
      renderPerms();
    };
  }
}

function handle(frame) {
  if (frame.type === "taskList") { renderTasks(frame.tasks || []); return; }
  if (frame.type === "timeline") { renderTimeline(frame.messages || []); return; }
  if (frame.type === "events") { applyEvents(frame); return; }
  if (frame.type === "accepted") { el("input").value = ""; requestTimeline(); return; }
}

function renderTasks(tasks) {
  var box = el("taskList");
  box.innerHTML = "";
  if (!tasks.length) { box.innerHTML = '<p class="tip">当前工作区还没有任务。</p>'; setConn("已连接"); return; }
  // 跨工作区聚合：按 workspaceLabel 分组渲染（对齐官方多工作区任务列表）。
  var groups = {};
  var order = [];
  for (var i = 0; i < tasks.length; i++) {
    var label = tasks[i].workspaceLabel || "默认";
    if (!groups[label]) { groups[label] = []; order.push(label); }
    groups[label].push(tasks[i]);
  }
  for (var g = 0; g < order.length; g++) {
    var groupCard = document.createElement("div");
    groupCard.className = "card";
    var head = document.createElement("div");
    head.className = "title";
    head.textContent = order[g];
    groupCard.appendChild(head);
    for (var j = 0; j < groups[order[g]].length; j++) {
      var t = groups[order[g]][j];
      var row = document.createElement("div");
      row.className = "task";
      var badge = t.status === "running" ? '<span class="badge running">生成中</span>' : '<span class="badge idle">空闲</span>';
      row.innerHTML = '<span class="title">' + esc(t.title || "(无标题)") + '</span>' + badge;
      row.setAttribute("data-task", esc(t.taskId));
      row.onclick = function () {
        currentTaskId = this.getAttribute("data-task");
        show("chat");
        requestTimeline();
      };
      groupCard.appendChild(row);
    }
    box.appendChild(groupCard);
  }
  setConn("已连接");
}

function renderTimeline(messages) {
  var box = el("timeline");
  box.innerHTML = "";
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : "assistant");
    div.textContent = extractText(m);
    box.appendChild(div);
  }
  window.scrollTo(0, document.body.scrollHeight);
}

function extractText(message) {
  var parts = message.parts || [];
  var out = "";
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p.type === "text" && p.text) { out += p.text + "\\n"; }
    else if (p.type === "tool_call" && p.name) { out += "🔧 " + p.name + "\\n"; }
    else if (p.type === "thinking" && p.thinking) { out += p.thinking + "\\n"; }
  }
  if (!out && message.preview) { out = message.preview; }
  return out || "(空)";
}

el("back").onclick = function () {
  currentTaskId = null;
  show("tasks");
  requestList();
};
el("send").onclick = function () {
  var input = el("input");
  if (!input.value.trim() || !currentTaskId) return;
  sendFrame({ type: "send", taskId: currentTaskId, content: input.value });
  input.value = "";
};
el("stop").onclick = function () {
  if (currentTaskId) sendFrame({ type: "stop", taskId: currentTaskId });
};

if (!deviceSid || !passHash) { show("unpaired"); setConn("缺少配对参数"); }
else { connect(); }
</script>
</body>
</html>
`;
