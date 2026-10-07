// R3 P2a 移动页入口。
import { createRoot } from "react-dom/client";
import { DesktopWindowFrame } from "@drora/ui/remote-frame";
import { App } from "./App.js";
import "./styles.css";
import "@drora/ui/styles.css";

// 诊断探针（无头验收：白屏时 IAB 可读 title 即错误摘要——console 不可读的硬限制补偿）。
// 常态无错误时 title 不被改写；探针只在 window error / unhandled rejection 时生效。
window.addEventListener("error", (event) => {
  document.title =
    "ERR: " +
    String(event.error?.stack ?? event.error?.message ?? event.message).slice(0, 300);
});
window.addEventListener("unhandledrejection", (event) => {
  document.title =
    "REJ: " +
    String(event.reason?.stack ?? event.reason?.message ?? event.reason).slice(0, 300);
});

const container = document.getElementById("root");
if (!container) throw new Error("#root container is missing");
createRoot(container).render(
  <DesktopWindowFrame title="Drora Remote" isDesktop={false}>
    <App />
  </DesktopWindowFrame>,
);
