/* eslint-disable max-lines -- 手机页单文件聚合（样式+加密+UI+传输），与 LAN 手机页同例。 */
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
  /* 色板对齐官方托管页暗色主题（取证官方资产库 index-BBMxRATx.css：Tailwind v4 neutral 色阶 + 白色透明度叠加）。 */
  :root {
    --bg: #171717;               /* neutral-900 */
    --surface: rgba(255, 255, 255, 0.05);
    --surface-hover: rgba(255, 255, 255, 0.1);
    --border: rgba(255, 255, 255, 0.1);
    --border-hover: rgba(255, 255, 255, 0.3);
    --fg: #e5e5e5;               /* neutral-200 */
    --fg-subtle: rgba(229, 229, 229, 0.6);
    --warning: #eab308;          /* yellow-500，配对点 = bg-warning + animate-pulse */
    --success: #16a34a;          /* green-600 */
    --destructive: #dc2626;      /* red-600 */
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; }
  header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; position: sticky; top: 0; background: var(--bg); z-index: 2; }
  header h1 { font-size: 16px; margin: 0; flex: 1; }
  main { padding: 12px 16px 40px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .task { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 2px; border-bottom: 1px solid var(--border); cursor: pointer; }
  .task:hover { background: var(--surface-hover); }
  .task:last-child { border-bottom: 0; }
  .title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; flex-shrink: 0; }
  .badge.running { background: rgba(22, 163, 74, 0.15); color: var(--success); }
  .badge.idle { background: var(--surface-hover); color: var(--fg-subtle); }
  .msg { padding: 8px 10px; border-radius: 10px; margin: 6px 0; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: var(--surface-hover); }
  .msg.assistant { background: var(--surface); }
  input, textarea, button { font: inherit; }
  textarea { width: 100%; min-height: 72px; background: var(--surface); color: inherit; border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  button { flex: 1; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-hover); color: inherit; cursor: pointer; }
  button.secondary { background: var(--surface); }
  .hidden { display: none; }
  .tip { color: var(--fg-subtle); font-size: 13px; }
  .dot { width: 10px; height: 10px; border-radius: 999px; background: var(--warning); display: inline-block; animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  @keyframes pulse { 50% { opacity: 0.5; } }
  .dot.fail { background: var(--destructive); animation: none; }
  .fail-detail { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--fg-subtle); }
  .load-head { display: flex; align-items: center; gap: 10px; }
  .load-title { font-size: 15px; font-weight: 600; }
  .steps { display: grid; gap: 8px; margin-top: 14px; }
  .step { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 12px; font-size: 13px; color: var(--fg-subtle); }
  .step.done { color: var(--success); border-color: rgba(22, 163, 74, 0.3); }
  .step.active { color: var(--fg); border-color: var(--border-hover); }
  .perm { border-color: rgba(234, 179, 8, 0.25); background: rgba(234, 179, 8, 0.06); }
  .perm .title { font-weight: 600; margin-bottom: 4px; }
  /* 加载/失败卡视口居中（对齐官方托管页：状态卡在视口水平+垂直居中、宽视口限宽）。
     :not(.hidden) 作用域避免 ID 选择器压过 .hidden 的 display:none。 */
  #loading:not(.hidden), #unpaired:not(.hidden) { min-height: calc(100vh - 64px); display: flex; align-items: center; justify-content: center; }
  #loading .card, #unpaired .card { width: 100%; max-width: 600px; margin-bottom: 0; }
</style>
</head>
<body>
<header><h1>Drora</h1><span id="conn" class="tip">连接中…</span></header>
<main>
  <section id="loading" class="hidden">
    <div class="card">
      <div class="load-head"><span id="loadDot" class="dot"></span><span id="loadTitle" class="load-title">连接中转服务…</span></div>
      <p class="tip" id="loadDesc">正在连接桌面端的中转服务。</p>
      <div class="steps">
        <div class="step" id="st1">1. 连接中转服务</div>
        <div class="step" id="st2">2. 设备鉴权</div>
        <div class="step" id="st3">3. 等待桌面端配对</div>
        <div class="step" id="st4">4. 同步工作区</div>
      </div>
    </div>
  </section>
  <section id="unpaired" class="hidden"></section>
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
var bootstrapTimer = null;

var params = new URLSearchParams(location.search);
var deviceSid = params.get("sid") || "";
var passHash = params.get("hash") || "";

function el(id) { return document.getElementById(id); }
function show(id) {
  for (var s of ["unpaired", "loading", "tasks", "chat"]) el(s).classList.toggle("hidden", s !== id);
}
// 加载占位（对齐官方托管页的配对进度卡）：title/desc + 四步进度（done/active）。
function showLoading(title, desc, doneCount, activeCount) {
  show("loading");
  el("loadTitle").textContent = title;
  el("loadDesc").textContent = desc;
  for (var i = 1; i <= 4; i++) {
    var st = el("st" + i);
    st.classList.toggle("done", i <= doneCount);
    st.classList.toggle("active", i === activeCount);
  }
}
function esc(text) {
  var d = document.createElement("div");
  d.textContent = text == null ? "" : String(text);
  return d.innerHTML;
}
function setConn(text) { el("conn").textContent = text; }

// 失败面卡片（对齐官方托管页的失败视图：标题/描述/下一步/失败详情/重试按钮）。
var FAIL_CARDS = {
  kicked: {
    title: "已被其他设备接管",
    desc: "另一台远程控制设备已经接入，同一时间只能保留一个手机控制端。",
    steps: ["继续使用新接入的设备。", "如果要用本设备控制，请重新扫描桌面端二维码。"],
    detailLabel: "Relay 返回",
    detail: "KICKED",
    retryText: "重新连接"
  },
  authFailed: {
    title: "手机连接已失效",
    desc: "当前页面的二维码参数或鉴权信息已经失效，不能再作为控制端连接。",
    steps: ["不要复用旧截图或旧链接。", "回到桌面端扫描最新二维码。"],
    detailLabel: "失败原因",
    detail: "Missing or invalid Web remote control relay parameters.",
    retryText: "重新连接"
  },
  deviceOffline: {
    title: "桌面离线",
    desc: "与桌面端的连接已断开。桌面端恢复后本页会自动重新接入。",
    steps: ["确认桌面端已重新开启远程控制。", "保持电脑和手机网络可用。"],
    detailLabel: "",
    detail: "",
    retryText: "重新连接",
    recoverable: true
  },
  bootstrapTimeout: {
    title: "响应超时",
    desc: "手机端已经连上 relay，但桌面端没有及时返回工作区数据。",
    steps: ["确认桌面端没有休眠或卡在确认弹窗。", "保持电脑和手机网络可用后重试。"],
    detailLabel: "超时详情",
    detail: "Desktop did not respond in time.",
    retryText: "重试"
  },
  relayUnavailable: {
    title: "无法连接中转服务",
    desc: "与中转服务的连接多次失败，请检查网络或自建服务端状态。",
    steps: ["确认中转服务地址与端口可达。", "稍后重试。"],
    detailLabel: "",
    detail: "",
    retryText: "重试",
    recoverable: true
  }
};

function showFailureCard(kind, detailOverride) {
  var card = FAIL_CARDS[kind] || FAIL_CARDS.authFailed;
  terminal = !card.recoverable;
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  if (card.recoverable && !terminal) {
    // 可恢复失败面保留 2s 自动重连（如 DEVICE_OFFLINE 等桌面恢复）。
    retryTimer = setInterval(function () { if (deviceSid && passHash) { connect(); } }, 2000);
  }
  show("unpaired");
  var box = el("unpaired");
  box.innerHTML =
    '<div class="card fail">' +
      '<div class="load-head"><span class="dot fail"></span><span class="load-title">' + esc(card.title) + '</span></div>' +
      '<p class="tip">' + esc(card.desc) + '</p>' +
      '<div class="steps">' +
        card.steps.map(function (s, i) { return '<div class="step">' + (i + 1) + ". " + esc(s) + "</div>"; }).join("") +
      "</div>" +
      (card.detailLabel ? '<p class="tip">' + esc(card.detailLabel) + "：" + esc(detailOverride || card.detail) + "</p>" : "") +
      '<div class="row"><button type="button" id="failRetry">' + esc(card.retryText) + "</button></div>" +
    "</div>";
  var retry = el("failRetry");
  retry.onclick = function () { location.reload(); };
}

function connect() {
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host + "/ws");
  showLoading("连接中转服务…", "正在连接桌面端的中转服务。", 0, 1);
  ws.onopen = function () {
    showLoading("设备鉴权…", "正在向中转服务证明本机身份。", 1, 2);
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
      if (msg.pair_status === "matched") {
        showLoading("已配对，正在加载工作区…", "连接已建立，正在同步桌面端工作区和任务。", 3, 4);
      } else {
        showLoading("等待桌面端配对…", "手机端已就绪，等待桌面端会话匹配当前连接。", 2, 3);
      }
      onReady();
      return;
    }
    if (msg.type === "error") {
      if (msg.code === "KICKED") { showFailureCard("kicked"); return; }
      if (msg.code === "DEVICE_OFFLINE") { showFailureCard("deviceOffline"); return; }
      if (msg.code === "AUTH_FAILED" || msg.code === "WRONG_PARAM") { showFailureCard("authFailed", msg.message || msg.code); return; }
      setConn("服务错误：" + (msg.message || msg.code));
      return;
    }
    if (msg.type === "data" && msg.payload) {
      // drora-page-response 信封：{zcode_type, requestId, success, frame}——
      // 业务帧在 frame 字段内，必须解包后再分发（直接传信封会因无 type 静默忽略）。
      var p = msg.payload;
      if (p.zcode_type === "drora-page-response") {
        if (p.success === false) { setConn("请求失败：" + (p.error || "")); return; }
        if (p.frame) { handle(p.frame); }
      }
      return;
    }
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
  // auth_ack 后保持加载占位（对齐官方托管页）：等 taskList/timeline 数据到达再切视图。
  // 超时未收到数据 → desktop-bootstrap-timeout 失败面（对齐官方 sg 错误枚举）。
  if (bootstrapTimer) { clearTimeout(bootstrapTimer); bootstrapTimer = null; }
  bootstrapTimer = setTimeout(function () {
    bootstrapTimer = null;
    showFailureCard("bootstrapTimeout", "Desktop did not respond in time.");
  }, 20000);
  if (currentTaskId) { requestTimeline(); }
  else { requestList(); }
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
  if (frame.type === "taskList") {
    if (bootstrapTimer) { clearTimeout(bootstrapTimer); bootstrapTimer = null; }
    renderTasks(frame.tasks || [], frame.workspaces || []);
    return;
  }
  if (frame.type === "timeline") { renderTimeline(frame.messages || []); return; }
  if (frame.type === "events") { applyEvents(frame); return; }
  if (frame.type === "accepted") { el("input").value = ""; requestTimeline(); return; }
}
function renderTasks(tasks, workspaces) {
  show("tasks");
  var box = el("taskList");
  box.innerHTML = "";
  // 工作区清单 = PC 侧栏的同一集合（桌面推送的 relayServerUrl 工作区快照）；
  // 每个已打开工作区都渲染分组卡（无任务也显示），任务按所属工作区归组。
  var groups = {};
  var order = [];
  for (var w = 0; w < (workspaces || []).length; w += 1) {
    var wsEntry = workspaces[w];
    var wsKey = wsEntry.workspaceIdentity || wsEntry.workspacePath;
    if (groups[wsKey]) continue;
    groups[wsKey] = { label: wsEntry.label || wsEntry.workspacePath, tasks: [] };
    order.push(wsKey);
  }
  for (var i = 0; i < tasks.length; i += 1) {
    var t = tasks[i];
    var taskKey = t.workspaceIdentity || t.workspacePath;
    if (!groups[taskKey]) {
      groups[taskKey] = { label: t.workspaceLabel || t.workspacePath, tasks: [] };
      order.push(taskKey);
    }
    groups[taskKey].tasks.push(t);
  }
  if (!order.length) { box.innerHTML = '<p class="tip">当前工作区还没有任务。</p>'; setConn("已连接"); return; }
  for (var g = 0; g < order.length; g += 1) {
    var key = order[g];
    var groupCard = document.createElement("div");
    groupCard.className = "card";
    var head = document.createElement("div");
    head.className = "title";
    head.textContent = groups[key].label;
    groupCard.appendChild(head);
    for (var j = 0; j < groups[key].tasks.length; j += 1) {
      var t = groups[key].tasks[j];
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
    if (!groups[key].tasks.length) {
      var emptyTip = document.createElement("p");
      emptyTip.className = "tip";
      emptyTip.textContent = "暂无任务";
      groupCard.appendChild(emptyTip);
    }
    box.appendChild(groupCard);
  }
  show("tasks");
  setConn("已连接");
}

function renderTimeline(messages) {
  show("chat");
  var box = el("timeline");
  box.innerHTML = "";
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    // Drora Protocol legacy 消息行（DroraMessageWithParts）：role 在 info 内。
    // 桌面桥（serveMobilePageAction）已按 PC 同款投影判据过滤 model-only 上下文，
    // 这里只做渲染面（2026-09-29 schema 漂移修复后该 op 返回声明契约形状；
    // 旧 v1 页形状 role/tool_call/thinking 已随配对栈删除）。
    var info = m.info || {};
    var role = info.role;
    var div = document.createElement("div");
    div.className = "msg " + (role === "user" ? "user" : "assistant");
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
    if (p.type === "text" && p.text && !p.ignored && !p.synthetic) { out += p.text + "\\n"; }
    else if (p.type === "reasoning" && p.text) { out += "💭 " + p.text + "\\n"; }
    else if (p.type === "tool" && (p.tool || p.state)) {
      // 工具卡：标题优先（完成态含真实 title），状态后缀；错误附摘要行。
      var state = p.state || {};
      var label = state.title || p.tool || "tool";
      var suffix = state.status === "completed" ? "" : " (" + (state.status || "pending") + ")";
      out += "🔧 " + label + suffix + "\\n";
      if (state.status === "error" && state.error) { out += "   " + String(state.error).slice(0, 200) + "\\n"; }
    }
  }
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
