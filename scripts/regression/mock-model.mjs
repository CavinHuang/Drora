// Scripted model backend for drora↔zcode A/B regression.
//   node scripts/regression/mock-model.mjs --port 9310 --out <dir> [--plans <plans.json>]
//
// Speaks BOTH wire shapes so either side can point at it regardless of which
// protocol its env-alias provider selects:
//   POST /v1/chat/completions   (OpenAI, SSE stream + non-stream)
//   POST /v1/messages           (Anthropic, SSE stream + non-stream)
//   GET  /v1/models
//
// Script selection: the first `[[tag]]` found in any message content picks the
// plan; each request consumes the next step of that plan (sequential). Every
// request body is appended to <out>/requests.jsonl for harness diffing —
// the model request itself is an alignment surface (system prompt, tool specs).
//
// Zero dependencies; binds 127.0.0.1 only.
import http from "node:http";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg("port", 9310));
const OUT = arg("out", path.join(process.cwd(), "mock-out"));
const PLANS_FILE = arg("plans", "");

mkdirSync(OUT, { recursive: true });

// Default plans: enough for spike + text-only scenarios. Scenario files carry
// their own plans via --plans when needed.
const DEFAULT_PLANS = {
  default: [{ text: "你好，我是 mock 模型。" }],
  "text-1": [{ text: "这是一段确定性回复：1+1=2。" }],
  "text-2": [{ text: "第二轮确定性回复：2+2=4。" }],
  // title-generation requests embed the user's text, so they must NOT consume
  // scenario plan cursors — they get this dedicated plan instead
  title: [{ text: "Mock 会话标题" }],
};

let plans = DEFAULT_PLANS;
if (PLANS_FILE && existsSync(PLANS_FILE)) {
  plans = { ...DEFAULT_PLANS, ...JSON.parse(readFileSync(PLANS_FILE, "utf8")) };
}
const planCursor = new Map(); // tag -> next step index

const MOCK_ID = "chatcmpl-mock0000000000000000";
const CREATED = 1700000000;
const USAGE = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };

function logRequest(record) {
  try {
    appendFileSync(path.join(OUT, "requests.jsonl"), `${JSON.stringify(record)}\n`);
  } catch {
    /* logging must never break the stream */
  }
}

function pickTag(body) {
  const texts = [];
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      // phase10：role:"system"（drora 把 system prompt 放进 messages）不参与
      // 选计划——其内嵌的 [[..]] 形串（skill 清单等）会劫持 tag → default，
      // 用户内容里的 [[tag]] 才是计划锚（与 title 请求的 system 三形状判定同源）。
      if (m?.role === "system") continue;
      if (typeof m.content === "string") texts.push(m.content);
      else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (typeof part === "string") texts.push(part);
          else if (typeof part?.text === "string") texts.push(part.text);
        }
      }
    }
  }
  if (typeof body?.system === "string") texts.push(body.system);
  if (typeof body?.prompt === "string") texts.push(body.prompt);
  for (const t of texts) {
    const m = /\[\[([a-z0-9][a-z0-9-]*)\]\]/i.exec(t);
    if (m) return m[1];
  }
  return "default";
}

function nextStep(tag) {
  const plan = plans[tag] ?? plans.default;
  const i = planCursor.get(tag) ?? 0;
  planCursor.set(tag, i + 1);
  return plan[i] ?? { text: "MOCK_PLAN_EXHAUSTED" };
}

// phase10：选计划从最后一条文本起倒序扫描——skill/记忆说明性文档串里也有
// `[[name]]` 形样例（真值 system-reminder 注入），正序首match会被劫持到
// 不存在的计划 → default。场景约定 [[tag]] 在实际 prompt 尾部，倒序首见
// 即真实锚。
function pickTagReverse(body) {
  const texts = [];
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (m?.role === "system") continue;
      if (typeof m.content === "string") texts.push(m.content);
      else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (typeof part === "string") texts.push(part);
          else if (typeof part?.text === "string") texts.push(part.text);
        }
      }
    }
  }
  if (typeof body?.system === "string") texts.push(body.system);
  if (typeof body?.prompt === "string") texts.push(body.prompt);
  for (let i = texts.length - 1; i >= 0; i--) {
    const m = /\[\[([a-z0-9][a-z0-9-]*)\]\]/i.exec(texts[i]);
    if (m) return m[1];
  }
  return "default";
}

/** 计划步工具参数内的 $MOCKURL → 本实例地址。两侧 mock 端口各自随机，
 *  harness 归一化器把 127.0.0.1:<port> 折叠为 <PORT>，因此 WebFetch 类
 *  网络工具可用自身 /v1/models 作确定性抓取目标（零外网依赖）。 */
function substMockUrl(step) {
  if (!Array.isArray(step.toolCalls) || step.toolCalls.length === 0) return step;
  const url = `http://127.0.0.1:${PORT}`;
  const walk = (v) => {
    if (typeof v === "string") return v.split("$MOCKURL").join(url);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return { ...step, toolCalls: step.toolCalls.map((c) => ({ ...c, arguments: walk(c.arguments ?? {}) })) };
}

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- OpenAI shape ----------------------------------------------------------

function openaiChunks(step, model) {
  const chunks = [];
  const base = { id: MOCK_ID, object: "chat.completion.chunk", created: CREATED, model };
  chunks.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  if (step.reasoning) {
    // GLM/OpenAI-compat 思考链：reasoning_content delta 在 content 之前，
    // 拆两段让两侧都见到多 delta 流（A/B 同形刺激）。
    const mid = Math.ceil(step.reasoning.length / 2);
    chunks.push({ ...base, choices: [{ index: 0, delta: { reasoning_content: step.reasoning.slice(0, mid) }, finish_reason: null }] });
    chunks.push({ ...base, choices: [{ index: 0, delta: { reasoning_content: step.reasoning.slice(mid) }, finish_reason: null }] });
  }
  if (step.text) {
    // split once so both sides see a multi-delta stream
    const mid = Math.ceil(step.text.length / 2);
    chunks.push({ ...base, choices: [{ index: 0, delta: { content: step.text.slice(0, mid) }, finish_reason: null }] });
    chunks.push({ ...base, choices: [{ index: 0, delta: { content: step.text.slice(mid) }, finish_reason: null }] });
  }
  const calls = step.toolCalls ?? [];
  calls.forEach((call, i) => {
    chunks.push({
      ...base,
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: i, id: `call_${i + 1}`, type: "function", function: { name: call.name, arguments: "" } }] },
        finish_reason: null,
      }],
    });
    const args = JSON.stringify(call.arguments ?? {});
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: args } }] }, finish_reason: null }],
    });
  });
  chunks.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }],
  });
  return chunks;
}

function openaiFull(step, model) {
  const calls = step.toolCalls ?? [];
  return {
    id: MOCK_ID,
    object: "chat.completion",
    created: CREATED,
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        ...(step.reasoning ? { reasoning_content: step.reasoning } : {}),
        ...(step.text ? { content: step.text } : {}),
        ...(calls.length > 0 ? { tool_calls: calls.map((c, i) => ({ id: `call_${i + 1}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) } : {}),
      },
      finish_reason: calls.length > 0 ? "tool_calls" : "stop",
    }],
    usage: USAGE,
  };
}

// ---- Anthropic shape -------------------------------------------------------

function anthropicEvents(step, model) {
  const events = [];
  let block = 0;
  events.push(["message_start", {
    type: "message_start",
    message: { id: "msg_mock000000000000", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: USAGE.prompt_tokens, output_tokens: 0 } },
  }]);
  if (step.reasoning) {
    // anthropic thinking 块：thinking_delta 拆两段 + signature_delta 收口
    // （AI SDK anthropic provider 依赖签名块合成 reasoning part）。
    const mid = Math.ceil(step.reasoning.length / 2);
    events.push(["content_block_start", { type: "content_block_start", index: block, content_block: { type: "thinking", thinking: "" } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index: block, delta: { type: "thinking_delta", thinking: step.reasoning.slice(0, mid) } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index: block, delta: { type: "thinking_delta", thinking: step.reasoning.slice(mid) } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index: block, delta: { type: "signature_delta", signature: "sig_mock" } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index: block }]);
    block += 1;
  }
  if (step.text) {
    const mid = Math.ceil(step.text.length / 2);
    events.push(["content_block_start", { type: "content_block_start", index: block, content_block: { type: "text", text: "" } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index: block, delta: { type: "text_delta", text: step.text.slice(0, mid) } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index: block, delta: { type: "text_delta", text: step.text.slice(mid) } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index: block }]);
    block += 1;
  }
  (step.toolCalls ?? []).forEach((call, i) => {
    events.push(["content_block_start", { type: "content_block_start", index: block, content_block: { type: "tool_use", id: `toolu_${i + 1}`, name: call.name, input: {} } }]);
    const args = JSON.stringify(call.arguments ?? {});
    events.push(["content_block_delta", { type: "content_block_delta", index: block, delta: { type: "input_json_delta", partial_json: args } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index: block }]);
    block += 1;
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: (step.toolCalls ?? []).length > 0 ? "tool_use" : "end_turn" }, usage: { output_tokens: USAGE.completion_tokens } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events;
}

function anthropicFull(step, model) {
  const content = [];
  if (step.reasoning) content.push({ type: "thinking", thinking: step.reasoning, signature: "sig_mock" });
  if (step.text) content.push({ type: "text", text: step.text });
  (step.toolCalls ?? []).forEach((c, i) => content.push({ type: "tool_use", id: `toolu_${i + 1}`, name: c.name, input: c.arguments ?? {} }));
  return {
    id: "msg_mock000000000000",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: (step.toolCalls ?? []).length > 0 ? "tool_use" : "end_turn",
    usage: { input_tokens: USAGE.prompt_tokens, output_tokens: USAGE.completion_tokens },
  };
}

// ---- server ----------------------------------------------------------------

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* treated as {} */ }
    const record = { at: Date.now(), path: req.url, body };
    logRequest(record);

    // harness calls between scenarios so plan cursors start fresh
    if (req.method === "POST" && req.url?.startsWith("/reset")) {
      planCursor.clear();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: body.model ?? "mock-model", object: "model" }] }));
      return;
    }

    // 标题请求的 system 三形状（zcode 发 body.system 数组 content blocks、
    // drora 发 messages 内 role:"system"——OpenAI 风格，CLI 旧面发 string）
    // ——只判 body.system 时 drora 形状漏判，标题请求按 [[tag]] 偷走场景
    // 计划步（可能偷到 toolCalls 步→无 text→cleanGeneratedTitle 抛错被
    // fire-and-forget 吞掉→generated 标题事件永不发布）。
    const systemText = typeof body.system === "string"
      ? body.system
      : Array.isArray(body.system) ? body.system.map((b) => b?.text ?? "").join("\n") : "";
    const messageSystemText = Array.isArray(body.messages)
      ? body.messages.filter((m) => m?.role === "system").map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((b) => b?.text ?? "").join("\n") : "")).join("\n")
      : "";
    const isTitleRequest = (systemText + "\n" + messageSystemText).includes("title-generation task");
    const step = substMockUrl(nextStep(isTitleRequest ? "title" : pickTagReverse(body)));
    const model = typeof body.model === "string" && body.model ? body.model : "mock-model";

    if (step.httpStatus) {
      res.writeHead(step.httpStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(step.body ?? { error: { message: "mock error" } }));
      return;
    }

    if (step.delayMs) await sleep(step.delayMs);
    const stream = body.stream === true;
    const anthropic = req.url?.startsWith("/v1/messages");

    if (anthropic) {
      res.writeHead(200, { "content-type": stream ? "text/event-stream" : "application/json" });
      if (stream) {
        for (const [event, data] of anthropicEvents(step, model)) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
        res.end();
      } else {
        res.end(JSON.stringify(anthropicFull(step, model)));
      }
      return;
    }

    // OpenAI
    res.writeHead(200, { "content-type": stream ? "text/event-stream" : "application/json" });
    if (stream) {
      for (const chunk of openaiChunks(step, model)) sseWrite(res, chunk);
      if (body.stream_options?.include_usage) {
        sseWrite(res, { id: MOCK_ID, object: "chat.completion.chunk", created: CREATED, model, choices: [], usage: USAGE });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.end(JSON.stringify(openaiFull(step, model)));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-model listening on http://127.0.0.1:${PORT} (out: ${OUT})`);
});
