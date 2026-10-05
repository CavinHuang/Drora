import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  INSECURE_CONTEXT_CLIPBOARD_SHIM_JS,
  INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER,
  injectOfficialPageClipboardShim,
} from "../src/insecureContextClipboardShim.js";

function createBrowserShape(copySucceeds: boolean) {
  let copied = "";
  let attached = false;
  let selected = false;
  let restoredFocus = false;
  const originalFocus = {
    focus: () => {
      restoredFocus = true;
    },
  };
  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: () => {},
    focus: () => {},
    select: () => {
      selected = true;
    },
    remove: () => {
      attached = false;
    },
  };
  const document = {
    activeElement: originalFocus,
    body: {
      appendChild: () => {
        attached = true;
      },
    },
    createElement: () => textarea,
    execCommand: (command: string) => {
      assert.equal(command, "copy");
      if (attached && selected) copied = textarea.value;
      return copySucceeds;
    },
  };
  const navigator: { clipboard?: { writeText(text: string): Promise<void> } } = {};
  vm.runInNewContext(INSECURE_CONTEXT_CLIPBOARD_SHIM_JS, {
    isSecureContext: false,
    document,
    navigator,
  });
  return {
    navigator,
    result: () => ({ copied, attached, restoredFocus }),
  };
}

test("LAN HTTP 提供 Promise writeText，用户点击形状同步复制并清理临时节点", async () => {
  const browser = createBrowserShape(true);
  assert.equal(typeof browser.navigator.clipboard?.writeText, "function");
  await browser.navigator.clipboard?.writeText("复制测试");
  assert.deepEqual(browser.result(), {
    copied: "复制测试",
    attached: false,
    restoredFocus: true,
  });
  assert.equal("readText" in (browser.navigator.clipboard ?? {}), false);
  assert.equal("write" in (browser.navigator.clipboard ?? {}), false);
});

test("底层 copy 返回 false 时 reject；原生 clipboard 与安全上下文零改动", async () => {
  const browser = createBrowserShape(false);
  await assert.rejects(browser.navigator.clipboard?.writeText("x"), /copy unavailable/);
  assert.equal(browser.result().attached, false);

  const native = { writeText: async () => {} };
  const secureNavigator = { clipboard: native };
  vm.runInNewContext(INSECURE_CONTEXT_CLIPBOARD_SHIM_JS, {
    isSecureContext: true,
    navigator: secureNavigator,
    document: {},
  });
  assert.equal(secureNavigator.clipboard, native);

  const missingNative: Record<string, unknown> = {};
  vm.runInNewContext(INSECURE_CONTEXT_CLIPBOARD_SHIM_JS, {
    isSecureContext: true,
    navigator: missingNative,
    document: {},
  });
  assert.equal(missingNative.clipboard, undefined);
});

test("HTML 注入在官方脚本前且幂等", () => {
  const html = "<!doctype html><html><head><script src='/remote/v4/app.js'></script></head></html>";
  const once = injectOfficialPageClipboardShim(html);
  assert.ok(once.includes(INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER));
  assert.ok(once.indexOf(INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER) < once.indexOf("app.js"));
  assert.equal(injectOfficialPageClipboardShim(once), once);
});
