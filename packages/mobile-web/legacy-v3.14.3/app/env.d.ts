// vite define 注入的全局常量（见 vite.config.ts：__MOBILE_APP_VERSION__ = 包版本）。
// 取证：二维码/协议面固定上报官方兼容版本（desktop OFFICIAL_REMOTE_PAGE_APP_VERSION
// 同源语义）；以本包 version 字段为单一来源，构建期注入。
declare const __MOBILE_APP_VERSION__: string;

declare module "*.css";
