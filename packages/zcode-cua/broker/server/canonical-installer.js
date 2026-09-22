// oxlint-disable-file
// 还原草稿：仅供继续手工重建参考，不参与编译
import { Oh } from "./helper-verifier.js";
import { qu } from "./helper-installer.js";
// 还原草稿（块级切分，待手工修正导入与类型）
export function k$(e) {
    switch (e.trim().toLowerCase()) {
        case "amd64":
        case "x86_64":
        case "x64":
            return "x64";
        case "aarch64":
        case "arm64":
            return "arm64";
        default:
            return e.trim();
    }
}
k$;
export function P$(e) {
    return [...new Set(e.map(k$).filter(Boolean))];
}
P$;
export function C$(e) {
    let t = e.dependencies?.readExecutableArchs ?? Oh.readExecutableArchs;
    return {
        ...e,
        dependencies: {
            ...e.dependencies,
            readExecutableArchs: async (n) => P$(await t(n)),
        },
    };
}
C$;
export function Hb(e, t = qu) {
    return t(C$(e));
}
