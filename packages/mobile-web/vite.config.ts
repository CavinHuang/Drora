// R3 P2a 源码应用构建（specs/mobile-relay-r3-frontend.md §13）：vite 打包 src/app
// React 入口，scripts/build-app.mjs 负责把产物排列成官方路径形状
// dist/remote/v4/index.html + dist/remote/v4/3.14.3/assets/*。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  root: resolve(import.meta.dirname, "src/app"),
  base: "/remote/v4/3.14.3/",
  plugins: [react(), tailwindcss()],
  define: {
    // 官方兼容版本（协议面上报值）：单一来源 = 本包 version 字段。
    __MOBILE_APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: resolve(import.meta.dirname, ".vite-out"),
    emptyOutDir: true,
    // 官方单文件 6.2MB 是反面教材（spec §6）：依赖分包，应用与 vendor 分离。
    // vite 8（rolldown）的 manualChunks 只收函数形态。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Windows/posix 路径分隔都命中：字符类 = 反斜杠 + 斜杠。
          if (/[\\/]react-dom[\\/]|[\\/]react[\\/]|[\\/]scheduler[\\/]/.test(id)) return "react";
          if (id.includes("@drora/rpc") || id.includes("@drora/client")) return "rpc";
          return "vendor";
        },
      },
    },
    target: "es2022",
  },
});
