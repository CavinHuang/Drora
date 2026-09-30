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
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "../ui/src") },
    // ui 源直引（@ 别名）与 mobile-web 自身的 react 必须同拷贝——否则 Context 全失效
    // （useIntl must be used within IntlProvider 症状；pnpm 嵌套 react 双拷贝坑）。
    dedupe: ["react", "react-dom", "@drora/shared", "@drora/services", "@drora/rpc"],
  },
  base: "/remote/v4/3.14.3/",
  plugins: [react(), tailwindcss()],
  define: {
    // 官方兼容版本（协议面上报值）：单一来源 = 本包 version 字段。
    __MOBILE_APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: resolve(import.meta.dirname, ".vite-out"),
    emptyOutDir: true,
    // 时间线包含按需加载的语法高亮语言包；不能把全部 node_modules 强制并进
    // vendor，否则所有语言包都会在任务面首屏同步加载。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Windows/posix 路径分隔都命中：字符类 = 反斜杠 + 斜杠。
          if (/[\\/]react-dom[\\/]|[\\/]react[\\/]|[\\/]scheduler[\\/]/.test(id)) return "react";
          return undefined;
        },
      },
    },
    target: "es2022",
  },
});
