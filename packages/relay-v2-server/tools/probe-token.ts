// M0 探针:离线解 drora JWT,打印 payload 每个 claim 的键名/值类型/长度;值一律脱敏,绝不打印。
// 依据:specs/relay-v2-server.md §6.1(M0 token 实测,先行于一切鉴权实现)与 §12(M0 里程碑)。
//
// ## 直跑方式(无需构建)
//
// Node ≥24 原生类型剥离(仓库工具链钉版 node 24.14.0),直接:
//   node packages/relay-v2-server/tools/probe-token.ts <token 文件路径>
//   cat token.txt | node packages/relay-v2-server/tools/probe-token.ts
//   node packages/relay-v2-server/tools/probe-token.ts -      # "-" 显式表示读 stdin
// 文件/stdin 内容取整段修剪后的文本;允许带 "Bearer " 前缀(与 src/auth.ts 的
// parseBearerToken 同款先例)。只做离线解码:仅 import node: 内置模块,零网络请求,不落盘。
//
// ## M0 验证清单(spec §6.1;本工具承担第 1–2 步的解码取证)
//
// 1. 取两平台真实 drora JWT:桌面为 oauth:zai:access_token 业务 token
//    (zaiProviderAdapter /api/auth/z/login 响应),手机为同源 localStorage 的 drorajwttoken;
// 2. 用本工具离线解码,把 claim 形状(键名/值类型/长度)脱敏归档进 spec 附录;
// 3. 核对身份 claim 是否落在 JWT_ID_CLAIMS 回退链(默认 sub,id)内 → 决定 §6.2 decode 模式;
// 4. 核对 iss 是否存在、两平台是否可区分 → 决定 §6.3 JWT_REALM_MODE=iss 可行性;
// 5. 核对 exp 存在性与单位(数字位数可分辨秒 10 位/毫秒 13 位)→ decode 的过期拒绝依赖它;
// 6. 核对 header 的 alg/kid 形状 → §6.2 jwks 模式(RS/ES 验签)的探测输入;
// 7. 「同一账号桌面与手机 JWT 映射到同一 userId」与 jwks/introspect 端点探测是 M0 其余动作,
//    不在本工具内;结论回写 spec §6.2/§6.3 默认值后方可定案。
//
// ## 实现约束
//
// - 不 import 包内 src/:node 直跑的类型剥离无法把 .js 后缀相对导入解析回 .ts 源文件,而
//   M0 先行于构建(干净检出时 dist 可能不存在)。输出统一走 process.stdout/stderr.write
//   (与 src/logger.ts 注入 write 的同一输出汇),不使用 console.log(仓库日志纪律)。
// - 红线(spec §9):任何输出只含键名/值类型/长度,值从不进入 stdout/stderr——包括
//   iss、sub 在内的所有 claim,以及 signature 段。
// - 退出码:0 成功;1 用法/读取错误;2 JWT 形状或解码失败。

import { readFile } from "node:fs/promises";

interface ClaimShape {
  key: string;
  type: string;
  /** 脱敏元数据:字符串取字符长度,数组取元素数,对象取 JSON 字节数,数字取位数 */
  size: string;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/** 与 src/auth.ts decodeJwtObject 同款:base64url → JSON 对象,形状非法返回 undefined */
function decodeSegment(segment: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** RFC 7519 三段式;与 src/auth.ts splitJwt 同款非空校验 */
function splitJwt(jwt: string): [string, string, string] | undefined {
  const [header, payload, signature] = jwt.split(".");
  if (
    header === undefined ||
    payload === undefined ||
    signature === undefined ||
    header.length === 0 ||
    payload.length === 0 ||
    signature.length === 0
  ) {
    return undefined;
  }
  return [header, payload, signature];
}

/** 把一个 claim 值折算成脱敏元数据;任何分支都不产生值本身 */
function describeClaim(value: unknown): ClaimShape["size"] {
  if (typeof value === "string") return `字符串 长度 ${value.length}`;
  if (value === null) return "null 无长度";
  if (Array.isArray(value)) return `数组 ${value.length} 项`;
  if (typeof value === "object") {
    try {
      return `对象 JSON ${Buffer.byteLength(JSON.stringify(value) ?? "")} 字节`;
    } catch {
      return "对象 不可序列化";
    }
  }
  if (typeof value === "number") {
    // 位数服务 §6.1 单位核对:秒级 exp 为 10 位,毫秒为 13 位;只给位数不给数值
    return `数字 ${String(value).length} 位`;
  }
  return `${typeof value} 无长度`;
}

function shapesOf(record: Record<string, unknown>): ClaimShape[] {
  return Object.keys(record).map((key) => ({
    key,
    type: Array.isArray(record[key]) ? "array" : record[key] === null ? "null" : typeof record[key],
    size: describeClaim(record[key]),
  }));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  let raw: string;
  if (arg !== undefined && arg !== "-") {
    // 异步 IO(仓库纪律);文件路径不出现在任何错误信息之外的位置,路径由调用方提供非机密
    raw = await readFile(arg, "utf8");
    out(`来源: 文件 ${arg}`);
  } else {
    if (arg === undefined && process.stdin.isTTY) {
      err("用法: node tools/probe-token.ts <token 文件路径> | - (stdin)");
      err("红线: token 请经文件或管道进入,不要作为 shell 历史可见的命令行参数粘贴。");
      process.exitCode = 1;
      return;
    }
    raw = await readStdin();
    out("来源: stdin");
  }

  const jwt = raw.trim().replace(/^Bearer\s+/i, "");
  const parts = splitJwt(jwt);
  if (parts === undefined) {
    err("解码失败: 输入不是三段式 JWT(header.payload.signature,各段非空)。");
    process.exitCode = 2;
    return;
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeSegment(headerB64);
  const payload = decodeSegment(payloadB64);
  if (header === undefined || payload === undefined) {
    err("解码失败: header/payload 段不是 base64url 编码的 JSON 对象。");
    process.exitCode = 2;
    return;
  }

  out(`段数: 3/3;signature: base64url 字符长度 ${signatureB64.length}(内容不输出)`);
  out("header claims:");
  for (const shape of shapesOf(header)) {
    out(`  ${shape.key.padEnd(16)} ${shape.type.padEnd(8)} ${shape.size}`);
  }
  out(`payload claims (${Object.keys(payload).length}):`);
  for (const shape of shapesOf(payload)) {
    out(`  ${shape.key.padEnd(16)} ${shape.type.padEnd(8)} ${shape.size}`);
  }
  out("红线自查: 以上仅键名/类型/长度,未输出任何 claim 值;归档进 spec 附录时保持此形状。");
}

try {
  await main();
} catch {
  // 读文件/读 stdin 失败:不回显任何输入内容(token 不进 stderr)
  err("读取输入失败: 文件不存在/不可读,或 stdin 读取中断(退出码 1)。");
  process.exitCode = 1;
}
