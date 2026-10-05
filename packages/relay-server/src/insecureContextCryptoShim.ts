// 非安全上下文 WebCrypto shim（specs/mobile-relay-server.md §12.10）：
// LAN 纯 HTTP 属浏览器非安全上下文，`crypto.subtle` 不暴露；官方 v4 页 proof
// 计算（index-NjWRUABD.js `sVn`）直接 `await globalThis.crypto.subtle.importKey/
// sign`（HMAC-SHA256）且无任何回退（全 bundle isSecureContext 出现 0 次）→ proof
// 抛 TypeError、`auth_response` 发不出 → relay 等不到应答、`auth_ack` 不返回 →
// 官方页恒停「正在认证设备…」监督重连循环。本模块产出一段自门控内联脚本，由
// staticAssets 在 /remote/** 的 200 HTML 出站时注入 <head> 起始处；磁盘字节与
// remoteAssets 缓存不改（注入只在出站做，§12.5 改写同语义）。
// SHA-256 算法核心复用 R2 页已验证的 PURE_JS_SHA256_CORE_JS（phonePage.ts，唯一
// 出处，RFC 4231/node:crypto 交叉校验锚定），本文件只补 WebCrypto 形状的胶水。
import { PURE_JS_SHA256_CORE_JS } from "./phonePage.js";
import { injectInlineHeadScript } from "./inlineHeadScript.js";

/** 幂等标记：HTML 已含该标识则不再注入（脚本体内同名变量即标记本体）。 */
export const INSECURE_CONTEXT_CRYPTO_SHIM_MARKER = "__zcodeInsecureCryptoShim";

// 覆盖面（官方 bundle 仅三处 subtle 用法，spec §12.10）：
//   ① sVn calculateProof：importKey(raw + HMAC/SHA-256) + sign("HMAC", key, data)
//   ② CUe 附件校验和：digest("SHA-256", ArrayBuffer)（非安全上下文下原为
//      fault.attachment.checksumUnavailable 降级，一并救活）
// 其余算法/格式一律 reject（fail-loud，不给官方页留下静默错误行为的面）。
export const INSECURE_CONTEXT_CRYPTO_SHIM_JS = `(function () {
  "use strict";
  var g = globalThis;
  if (typeof g.crypto === "undefined" || g.crypto === null) return;
  // LAN HTTP 无 randomUUID；官方 bundle、源码页命令与 relay-client 均会调用。
  // 只用 getRandomValues 的安全随机字节；缺失时保留原生失败，不用 Math.random。
  if (g.isSecureContext === false && typeof g.crypto.randomUUID !== "function" &&
      typeof g.crypto.getRandomValues === "function") {
    Object.defineProperty(g.crypto, "randomUUID", {
      configurable: true,
      value: function () {
        var bytes = new Uint8Array(16);
        g.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = [];
        for (var i = 0; i < bytes.length; i += 1) hex.push(bytes[i].toString(16).padStart(2, "0"));
        return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
          hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" +
          hex.slice(10).join("");
      },
    });
  }
  // 安全上下文（HTTPS/localhost）或已有实现：零改动（官方字节原行为）。
  if (g.crypto.subtle) return;
  var ${INSECURE_CONTEXT_CRYPTO_SHIM_MARKER} = 1;
  // —— 纯 JS SHA-256 核心（与 R2 页同一出处，勿在本文件手抄）——
  ${PURE_JS_SHA256_CORE_JS}
  function __hmacSha256(keyBytes, msgBytes) {
    var key = keyBytes;
    if (key.length > 64) key = __sha256Bytes(key);
    var outer = [];
    var inner = [];
    for (var i = 0; i < 64; i += 1) {
      var b = key[i] || 0;
      outer.push(b ^ 0x5c);
      inner.push(b ^ 0x36);
    }
    return __sha256Bytes(outer.concat(__sha256Bytes(inner.concat(msgBytes))));
  }
  function __bytesToArrayBuffer(bytes) {
    var out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i += 1) out[i] = bytes[i] & 255;
    return out.buffer;
  }
  function __toBytes(data) {
    // 用 ArrayBuffer.isView 判视图（按内部槽，跨 realm/iframe 可靠；instanceof
    // 在多 realm 页面会失配）；纯 ArrayBuffer 用 byteLength 鸭子判定。
    if (ArrayBuffer.isView(data)) {
      return Array.prototype.slice.call(new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength));
    }
    if (data && typeof data.byteLength === "number") {
      return Array.prototype.slice.call(new Uint8Array(data));
    }
    return Array.prototype.slice.call(new Uint8Array(Array.from(data)));
  }
  function __algName(algorithm) {
    if (typeof algorithm === "string") return algorithm.toUpperCase();
    if (algorithm && typeof algorithm.name === "string") return algorithm.name.toUpperCase();
    return "";
  }
  function __hashName(algorithm) {
    var hash = algorithm && algorithm.hash;
    if (typeof hash === "string") return hash.toUpperCase();
    if (hash && typeof hash.name === "string") return hash.name.toUpperCase();
    return "";
  }
  var subtle = {
    importKey: function (format, keyData, algorithm, extractable, usages) {
      if (format !== "raw") {
        return Promise.reject(new Error("crypto.subtle shim: only raw key format is supported"));
      }
      if (__algName(algorithm) !== "HMAC" || __hashName(algorithm) !== "SHA-256") {
        return Promise.reject(new Error("crypto.subtle shim: only HMAC/SHA-256 import is supported"));
      }
      return Promise.resolve({
        __rawBytes: __toBytes(keyData),
        type: "secret",
        algorithm: { name: "HMAC", hash: algorithm.hash },
        extractable: Boolean(extractable),
        usages: usages || [],
      });
    },
    sign: function (algorithm, key, data) {
      if (__algName(algorithm) !== "HMAC" || !key || !key.__rawBytes) {
        return Promise.reject(new Error("crypto.subtle shim: HMAC sign requires an imported key"));
      }
      return Promise.resolve(__bytesToArrayBuffer(__hmacSha256(key.__rawBytes, __toBytes(data))));
    },
    digest: function (algorithm, data) {
      if (__algName(algorithm) !== "SHA-256") {
        return Promise.reject(new Error("crypto.subtle shim: only SHA-256 digest is supported"));
      }
      return Promise.resolve(__bytesToArrayBuffer(__sha256Bytes(__toBytes(data))));
    },
  };
  // 浏览器中 subtle 是 Crypto.prototype 的只读 getter，官方页为 strict module
  //（直接赋值抛 TypeError），必须建实例自有属性遮蔽。
  Object.defineProperty(g.crypto, "subtle", {
    value: subtle,
    configurable: true,
    writable: false,
  });
})();
`;

/**
 * 入口文档出站注入（spec §12.10）：`<head>` 起始处插 shim；无 `<head>` 形态
 * （防御：非 Vite 布局的入口文档）前置到文档最前。已含标记即原样返回（幂等）。
 */
export function injectOfficialPageHtmlShim(html: string): string {
  return injectInlineHeadScript(
    html,
    INSECURE_CONTEXT_CRYPTO_SHIM_MARKER,
    INSECURE_CONTEXT_CRYPTO_SHIM_JS,
  );
}
