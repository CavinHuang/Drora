// 非安全上下文 WebCrypto shim 测试（specs/mobile-relay-server.md §12.10）：
// - vm 沙箱模拟非安全上下文（crypto 存在、subtle 缺失，即 LAN 纯 HTTP 形状）：
//   importKey+sign/digest 对照 node:crypto/createHash 权威实现——
//   含 RFC 4231 用例 2/6 形状、二进制 key 字节（strBytes 式 UTF-8 实现处理不了
//   的形状）、hash/algorithm 字符串与 {name} 对象两种官方用法；
// - 安全上下文（subtle 已存在）与 crypto 缺失：零改动/不抛；
// - injectOfficialPageHtmlShim：<head> 后插入、幂等、无 <head> 前置；
// - routeStaticRequest 端到端：staticRoot 与 remoteAssets 缓存（Buffer 体）两
//   来源的入口文档响应均含 shim 标记（三来源注入单点 outboundBodyWithShim）。
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import vm from "node:vm";
import {
  INSECURE_CONTEXT_CRYPTO_SHIM_JS,
  INSECURE_CONTEXT_CRYPTO_SHIM_MARKER,
  injectOfficialPageHtmlShim,
} from "../src/insecureContextCryptoShim.js";
import { INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER } from "../src/insecureContextClipboardShim.js";
import { routeStaticRequest } from "../src/staticAssets.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

interface ShimSubtle {
  importKey(
    format: string,
    keyData: Uint8Array | ArrayBuffer,
    algorithm: { name: string; hash: string | { name: string } },
  ): Promise<ShimKey>;
  sign(
    algorithm: string | { name: string },
    key: ShimKey,
    data: Uint8Array | ArrayBuffer,
  ): Promise<ArrayBuffer>;
  digest(
    algorithm: string | { name: string },
    data: Uint8Array | ArrayBuffer,
  ): Promise<ArrayBuffer>;
}

interface ShimKey {
  __rawBytes: number[];
}

/** 非安全上下文沙箱：crypto 有 getRandomValues、无 subtle（LAN HTTP 浏览器形状）。 */
function installShimInInsecureContext(): { subtle: ShimSubtle } {
  const sandbox: { crypto: Record<string, unknown> } = {
    crypto: { getRandomValues: () => new Uint8Array(0) },
  };
  vm.runInNewContext(INSECURE_CONTEXT_CRYPTO_SHIM_JS, sandbox);
  // shim 未激活时 undefined 会让后续解构失败——显式断言给出可读错误。
  const subtle = sandbox.crypto.subtle as ShimSubtle | undefined;
  assert.ok(subtle, "shim 应在无 subtle 的沙箱中安装 crypto.subtle");
  return { subtle };
}

function hexOf(buffer: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buffer)).toString("hex");
}

function nodeHmacHex(key: Buffer | string, data: string | Buffer): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** 官方页 calculateProof 的精确调用形状：importKey(raw, TextEncoder 编码, hash 对象) + sign("HMAC",…)。 */
async function officialProof(
  subtle: ShimSubtle,
  passHash: string,
  nonce: string,
  role: string,
  sid: string,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(passHash),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return subtle.sign("HMAC", key, encoder.encode(`${nonce}|${role}|${sid}`));
}

test("sign：官方调用形状 × RFC 4231 用例 2 形状（key=Jefe）对照 node:crypto", async () => {
  const { subtle } = installShimInInsecureContext();
  const digest = await officialProof(subtle, "Jefe", "what do ya wanna", "terminal", "free?");
  assert.equal(hexOf(digest), nodeHmacHex("Jefe", "what do ya wanna|terminal|free?"));
  assert.equal(digest.byteLength, 32);
});

test("sign：官方真实输入形状（十六进制 passHash + 中文 sid）与 node:crypto 一致", async () => {
  const { subtle } = installShimInInsecureContext();
  const passHash = "0123456789abcdef0123456789abcdef";
  const nonce = "a3f9c2e1b0d4f5e6a7b8c9d0e1f2a3b4";
  const sid = "设备终端-中文Sid-123";
  const digest = await officialProof(subtle, passHash, nonce, "terminal", sid);
  assert.equal(hexOf(digest), nodeHmacHex(passHash, `${nonce}|terminal|${sid}`));
});

test("sign：长 key（>64 字节，RFC 4231 用例 6 形状，需 key 分块预处理）", async () => {
  const { subtle } = installShimInInsecureContext();
  const longKey = "a".repeat(131);
  const digest = await officialProof(subtle, longKey, "msg", "terminal", "sid");
  assert.equal(hexOf(digest), nodeHmacHex(longKey, "msg|terminal|sid"));
});

test("sign：二进制 key 字节（含 0x00/0xff，UTF-8 字符串编码会失真的形状）", async () => {
  const { subtle } = installShimInInsecureContext();
  const rawKey = Uint8Array.from([0x00, 0x0b, 0xff, 0xfe, 0x80, 0x7f, 0x01]);
  const key = await subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: { name: "SHA-256" } },
    true,
    ["sign"],
  );
  // __rawBytes 产生于 vm realm（Array 原型不同），浅拷到宿主 realm 再比。
  assert.deepEqual([...key.__rawBytes], Array.from(rawKey));
  const digest = await subtle.sign({ name: "HMAC" }, key, Uint8Array.from([1, 2, 3]));
  assert.equal(hexOf(digest), nodeHmacHex(Buffer.from(rawKey), Buffer.from([1, 2, 3])));
});

test("digest：SHA-256 对照 createHash（ArrayBuffer 与 Uint8Array 两种入参）", async () => {
  const { subtle } = installShimInInsecureContext();
  const emptyDigest = await subtle.digest("SHA-256", new ArrayBuffer(0));
  assert.equal(
    hexOf(emptyDigest),
    createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
    "空输入摘要应为标准 e3b0c442…（官方 CUe 校验和形状）",
  );
  const payload = Uint8Array.from(Buffer.from("attachment-bytes-中文"));
  const digest = await subtle.digest({ name: "SHA-256" }, payload);
  assert.equal(hexOf(digest), createHash("sha256").update(Buffer.from(payload)).digest("hex"));
});

test("不支持的用法 fail-loud（非 raw / 非 HMAC-SHA256 / 无 key sign / 非 SHA-256 digest）", async () => {
  const { subtle } = installShimInInsecureContext();
  await assert.rejects(
    subtle.importKey("pkcs8", new Uint8Array(4), { name: "HMAC", hash: "SHA-256" }),
    /only raw/,
  );
  await assert.rejects(
    subtle.importKey("raw", new Uint8Array(4), { name: "HMAC", hash: "SHA-512" }),
    /only HMAC\/SHA-256/,
  );
  await assert.rejects(
    // {} 无 __rawBytes 字段 → 拒绝路径（空数组是 truthy，会走正常计算）。
    subtle.sign("HMAC", {} as ShimKey, new Uint8Array(0)),
    /requires an imported key/,
  );
  await assert.rejects(subtle.digest("SHA-1", new Uint8Array(0)), /only SHA-256 digest/);
});

test("安全上下文形状（subtle 已存在）：shim 零改动；crypto 整体缺失：不抛", () => {
  const existingSubtle = { marker: "real" };
  const secureSandbox = { crypto: { subtle: existingSubtle, getRandomValues: () => null } };
  vm.runInNewContext(INSECURE_CONTEXT_CRYPTO_SHIM_JS, secureSandbox);
  assert.equal(secureSandbox.crypto.subtle, existingSubtle);

  const noCryptoSandbox: Record<string, unknown> = {};
  vm.runInNewContext(INSECURE_CONTEXT_CRYPTO_SHIM_JS, noCryptoSandbox);
  assert.equal(noCryptoSandbox.crypto, undefined);
});

test("LAN HTTP 只用 getRandomValues 补 v4 UUID；安全上下文和缺随机源均不伪造", () => {
  const crypto: Record<string, unknown> = {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.forEach((_value, index) => {
        bytes[index] = index;
      });
      return bytes;
    },
  };
  vm.runInNewContext(INSECURE_CONTEXT_CRYPTO_SHIM_JS, { isSecureContext: false, crypto });
  assert.equal(typeof crypto.randomUUID, "function");
  assert.equal((crypto.randomUUID as () => string)(), "00010203-0405-4607-8809-0a0b0c0d0e0f");

  const secureCrypto = { subtle: { marker: "real" }, getRandomValues: () => null };
  vm.runInNewContext(INSECURE_CONTEXT_CRYPTO_SHIM_JS, {
    isSecureContext: true,
    crypto: secureCrypto,
  });
  assert.equal("randomUUID" in secureCrypto, false);

  const noRandomSource: Record<string, unknown> = {};
  vm.runInNewContext(INSECURE_CONTEXT_CRYPTO_SHIM_JS, {
    isSecureContext: false,
    crypto: noRandomSource,
  });
  assert.equal(noRandomSource.randomUUID, undefined);
});

test("注入：<head> 后插入脚本；重复注入幂等；无 <head> 前置", () => {
  const html =
    "<!doctype html><html lang=zh-CN><head><meta charset=utf-8></head><body></body></html>";
  const once = injectOfficialPageHtmlShim(html);
  // 官方页脚本是 module（defer 语义），shim 必须紧贴 <head> 起始处、先于一切执行。
  assert.ok(once.includes(`<head><script>${INSECURE_CONTEXT_CRYPTO_SHIM_JS}</script>`));
  assert.ok(once.indexOf(INSECURE_CONTEXT_CRYPTO_SHIM_MARKER) < once.indexOf("<body"));
  assert.equal(injectOfficialPageHtmlShim(once), once, "已含标记的 HTML 不得二次注入");

  const headless = "<!DOCTYPE html><html><body>x</body></html>";
  const prepended = injectOfficialPageHtmlShim(headless);
  assert.ok(prepended.startsWith(`<script>${INSECURE_CONTEXT_CRYPTO_SHIM_JS}</script>`));
});

test("routeStaticRequest：staticRoot 来源入口文档出站含 shim（§12.10 三来源单点）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-shim1-"));
  tempDirs.push(dir);
  const root = join(dir, "static");
  await mkdir(join(root, "remote", "v4"), { recursive: true });
  const entry = "<!doctype html><html><head><title>v4</title></head><body></body></html>";
  await writeFile(join(root, "remote", "v4", "index.html"), entry);
  const result = await routeStaticRequest({
    method: "GET",
    pathname: "/remote/v4",
    search: "?sid=s&hash=h",
    staticRootAbs: root,
    mobileRootAbs: null,
    remoteAssetsAbs: null,
    fetchImpl: globalThis.fetch,
  });
  assert.equal(result?.status, 200);
  assert.ok(String(result.body).includes(INSECURE_CONTEXT_CRYPTO_SHIM_MARKER));
  assert.ok(String(result.body).includes(INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER));
  const mobileRootResult = await routeStaticRequest({
    method: "GET",
    pathname: "/remote/v4",
    search: "",
    staticRootAbs: null,
    mobileRootAbs: root,
    remoteAssetsAbs: null,
    fetchImpl: globalThis.fetch,
  });
  assert.ok(String(mobileRootResult?.body).includes(INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER));
  // 非 HTML 资产不受注入影响（JS 改写路径与 shim 正交）。
  await writeFile(join(root, "remote", "v4", "chunk.js"), "console.log(1);");
  const jsResult = await routeStaticRequest({
    method: "GET",
    pathname: "/remote/v4/chunk.js",
    search: "",
    staticRootAbs: root,
    mobileRootAbs: null,
    remoteAssetsAbs: null,
    fetchImpl: globalThis.fetch,
  });
  assert.equal(jsResult?.status, 200);
  assert.equal(String(jsResult.body), "console.log(1);");
});

test("routeStaticRequest：remoteAssets 缓存来源（Buffer 体）入口文档出站含 shim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-shim2-"));
  tempDirs.push(dir);
  const cacheDir = join(dir, "cache");
  const entryPath = join(cacheDir, "remote", "v4", "index.html");
  await mkdir(dirname(entryPath), { recursive: true });
  const rawEntry = "<!doctype html><html><head></head><body></body></html>";
  await writeFile(entryPath, rawEntry);
  const result = await routeStaticRequest({
    method: "GET",
    pathname: "/remote/v4",
    search: "",
    staticRootAbs: null,
    mobileRootAbs: null,
    remoteAssetsAbs: cacheDir,
    fetchImpl: globalThis.fetch,
  });
  assert.equal(result?.status, 200);
  const body = String(result.body);
  assert.ok(body.includes(INSECURE_CONTEXT_CRYPTO_SHIM_MARKER));
  assert.ok(body.includes(INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER));
  // 磁盘缓存必须保持原始字节（注入只在出站做，spec §12.10 不变量）。
  assert.equal(await readFile(entryPath, "utf8"), rawEntry);
});
