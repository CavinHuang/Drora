// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
import { r as e } from "./src-BBFd38IP.js";
var t = e(
  () => `
  /* Font Awesome icon styling - consolidated */
  .label-icon {
    display: inline-block;
    height: 1em;
    overflow: visible;
    vertical-align: -0.125em;
  }
  
  .node .label-icon path {
    fill: currentColor;
    stroke: revert;
    stroke-width: revert;
  }
`,
  `getIconStyles`,
);
export { t };
