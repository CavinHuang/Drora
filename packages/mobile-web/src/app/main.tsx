// R3 P2a 移动页入口。
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import "@drora/ui/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root container is missing");
createRoot(container).render(<App />);
