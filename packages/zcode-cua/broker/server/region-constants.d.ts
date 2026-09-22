/** macOS 系统工具绝对路径（Helper 校验与权限探测使用） */
export declare const dn: Record<string, string>;
/** Helper bundle id */
export declare const HELPER_BUNDLE_ID_VALUE = "dev.zcode.cua-helper";
export declare const DEV_CUA_HELPER_BUNDLE_ID_VALUE = "dev.zcode.cua-helper.dev";
/** dev 模式下的秒级阈值等杂项常量 */
export declare const CUA_DEV_TIMEOUT_MS = 10000;
/** Helper 安装形态枚举 */
export declare const HELPER_INSTALL_VARIANTS: string[];
/** Helper 应用名 */
export declare const HELPER_APP_NAME_VALUE = "ZCode Computer Use";
export declare const DEV_HELPER_APP_NAME_VALUE = "ZCode Computer Use Dev";
/** 团队 ID（LaunchServices 校验用） */
export declare const HELPER_TEAM_ID = "8A5X4JJ39T";
/** PiP 会话协议名 */
export declare const CUA_PIP_SESSION_PROTOCOL = "zcode-cua-pip-session-v2";
export declare const CUA_PIP_NO_ACTIVE_SESSION_V2 = "__zcode_pip_no_active_session_v2__";
export declare const CUA_PIP_NO_ACTIVE_SESSION_PENDING = ".pending";
export declare const CUA_HEALTH_POLL_MS = 100;
export declare const HELPER_INSTALL_VARIANT_ENV = "ZCODE_CUA_HELPER_INSTALL_VARIANT";
export declare const HELPER_INSTALL_VARIANTS_LIST: string[];
export declare const HELPER_ADDON_ENV_VALUE = "ZCODE_CUA_HELPER_ADDON";
export declare const HELPER_GHOST_CURSOR_FLAG = "--ghost-cursor-capture";
export declare const DEV_HELPER_APP_NAME_APP = "ZCode Computer Use Dev.app";
