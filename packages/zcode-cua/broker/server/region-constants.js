// oxlint-disable-file
// 还原草稿：仅供继续手工重建参考，不参与编译
// 还原自发行 bundle 的 CUA 库共享常量（名称按原始语义恢复）。
/** macOS 系统工具绝对路径（Helper 校验与权限探测使用） */
export const dn = {
    codesign: "/usr/bin/codesign",
    ditto: "/usr/bin/ditto",
    lsof: "/usr/sbin/lsof",
    mdfind: "/usr/bin/mdfind",
    open: "/usr/bin/open",
    osascript: "/usr/bin/osascript",
    pbcopy: "/usr/bin/pbcopy",
    pbpaste: "/usr/bin/pbpaste",
    pgrep: "/usr/bin/pgrep",
    plist: "/usr/bin/plutil",
    plistBuddy: "/usr/libexec/PlistBuddy",
    ps: "/bin/ps",
    screencapture: "/usr/sbin/screencapture",
    sh: "/bin/sh",
    spctl: "/usr/sbin/spctl",
    syspolicyCheck: "/usr/bin/syspolicy_check",
    unzip: "/usr/bin/unzip",
    xattr: "/usr/bin/xattr",
};
/** Helper bundle id */
export const HELPER_BUNDLE_ID_VALUE = "dev.zcode.cua-helper";
export const DEV_CUA_HELPER_BUNDLE_ID_VALUE = "dev.zcode.cua-helper.dev";
/** dev 模式下的秒级阈值等杂项常量 */
export const CUA_DEV_TIMEOUT_MS = 10000;
/** Helper 安装形态枚举 */
export const HELPER_INSTALL_VARIANTS = ["stable", "preview", "dev-desktop", "standalone"];
/** Helper 应用名 */
export const HELPER_APP_NAME_VALUE = "ZCode Computer Use";
export const DEV_HELPER_APP_NAME_VALUE = "ZCode Computer Use Dev";
/** 团队 ID（LaunchServices 校验用） */
export const HELPER_TEAM_ID = "8A5X4JJ39T";
/** PiP 会话协议名 */
export const CUA_PIP_SESSION_PROTOCOL = "zcode-cua-pip-session-v2";
export const CUA_PIP_NO_ACTIVE_SESSION_V2 = "__zcode_pip_no_active_session_v2__";
export const CUA_PIP_NO_ACTIVE_SESSION_PENDING = ".pending";
export const CUA_HEALTH_POLL_MS = 100;
export const HELPER_INSTALL_VARIANT_ENV = "ZCODE_CUA_HELPER_INSTALL_VARIANT";
export const HELPER_INSTALL_VARIANTS_LIST = ["stable", "preview", "dev-desktop", "standalone"];
export const HELPER_ADDON_ENV_VALUE = "ZCODE_CUA_HELPER_ADDON";
export const HELPER_GHOST_CURSOR_FLAG = "--ghost-cursor-capture";
export const DEV_HELPER_APP_NAME_APP = "ZCode Computer Use Dev.app";
