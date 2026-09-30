import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

test("远控页复用 UI 窗口外壳并保留动态视口高度", async () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const server = await createServer({
    configFile: false,
    root: packageRoot,
    server: { middlewareMode: true },
    resolve: { alias: { "@": resolve(packageRoot, "../ui/src") } },
    plugins: [react()],
  });
  try {
    const { DesktopWindowFrame } = await server.ssrLoadModule("@drora/ui/remote-frame");
    const html = renderToStaticMarkup(
      React.createElement(
        DesktopWindowFrame,
        { title: "Drora Remote", isDesktop: false },
        React.createElement("main", null, "task surface"),
      ),
    );
    assert.match(html, /data-desktop-window-frame="true"/);
    assert.match(html, /class="[^"]*h-dvh[^"]*"/);
    assert.match(html, /<main>task surface<\/main>/);
  } finally {
    await server.close();
  }
});
